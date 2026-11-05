/**
 * Same Day Solution — Knteer Payout API adapter.
 *
 * Provides bank-account registration (beneficiary book) and direct bank-to-bank
 * transfers from the partner's Same Day wallet. This is a SEPARATE product from
 * the Settlement API (sameday-settlement.ts):
 *   - Settlement API  → /api/partner/settlement/*  (retailer payouts, existing)
 *   - Knteer Payout   → /api/partner/payout/*      (this module, NEW)
 *
 * Flow: getBalance → getBanks (optional) → verifyAccount (eKYC Hub, ₹4.72)
 *       → registerAccount → transfer → checkStatus
 *
 * Activate: PARTNER_KNTEER_PAYOUT_ENABLED=true
 *   needs: SAMEDAY_KNTEER_PAYOUT_API_KEY / SAMEDAY_KNTEER_PAYOUT_API_SECRET
 *          (falls back to SAMEDAY_POS_API_KEY / SECRET)
 *
 * CRITICAL: on transfer timeout/network error, call checkStatus() with the
 *           saved transactionId. NEVER blind-retry transfer — it may have
 *           already debited the partner wallet.
 */
import { logger } from "@/lib/logger";
import type { PartnerResult, PayoutOutput, PayoutProvider } from "./types";
import { toNumber } from "@/lib/money";
import { samedayCredentials, samedayRequest } from "./sameday-core";

const P = "/api/partner/payout";
const log = logger.child({ module: "sameday-knteer-payout" });

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

export function knteerPayoutConfigured(): boolean {
  return samedayCredentials("KNTEER_PAYOUT") !== null;
}

function creds() {
  const c = samedayCredentials("KNTEER_PAYOUT");
  if (!c)
    throw new Error(
      "[sameday-knteer-payout] SAMEDAY_KNTEER_PAYOUT_API_KEY/SECRET not configured"
    );
  return c;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KnteerPayoutStatus = "SUCCESS" | "PENDING" | "FAILED";

export type KnteerWalletBalance = {
  balance: number;
  isFrozen: boolean;
  freezeReason: string | null;
};

export type KnteerBank = {
  id: number;
  name: string;
  ifscPrefix: string;
  imps: boolean;
  neft: boolean;
};

export type KnteerVerifyResult = {
  isValid: boolean;
  accountHolderName: string | null;
  bankName: string | null;
  branchName: string | null;
  verificationCharges: number;
  referenceId: string | null;
  message: string;
};

export type KnteerAccount = {
  accountNumber: string; // masked e.g. "***********2946"
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
  isRegistered: boolean;
  isBankVerified: boolean;
};

export type KnteerRegisterResult = {
  alreadyRegistered: boolean;
  registrationType: "register" | "verify";
  verificationCharge: number;
  referenceId: string | null;
  message: string;
  account: KnteerAccount;
};

export type KnteerListAccount = {
  id: string;
  accountNumber: string; // masked
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
  mobile: string;
  isRegistered: boolean;
  createdAt: string;
};

export type KnteerTransferResult = {
  transactionId: string;
  partnerTransId: string;
  knteerTransId: string;
  utr: string | null;
  status: KnteerPayoutStatus;
  amount: number;
  charges: number;
  totalDebited: number;
  paymentMode: string;
  accountNumber: string; // masked in response
  accountHolderName: string;
  bankName: string;
  remarks: string | null;
  createdAt: string;
  createdAtIst: string;
  completedAt: string | null;
  completedAtIst: string | null;
};

export type KnteerTransaction = KnteerTransferResult & {
  ifscCode: string;
  partnerTransId: string;
};

// ---------------------------------------------------------------------------
// 1. GET WALLET BALANCE
// ---------------------------------------------------------------------------

export async function knteerGetBalance(): Promise<PartnerResult<KnteerWalletBalance>> {
  const r = await samedayRequest<{
    success: boolean;
    balance?: number;
    is_frozen?: boolean;
    freeze_reason?: string | null;
  }>(creds(), "GET", `${P}/balance`);

  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      balance: r.data.balance ?? 0,
      isFrozen: r.data.is_frozen ?? false,
      freezeReason: r.data.freeze_reason ?? null,
    },
    raw: r.raw,
  };
}

// ---------------------------------------------------------------------------
// 2. GET SUPPORTED BANKS
// ---------------------------------------------------------------------------

export async function knteerGetBanks(filters?: {
  imps?: boolean;
  neft?: boolean;
  popular?: boolean;
  search?: string;
}): Promise<PartnerResult<{ banks: KnteerBank[]; total: number }>> {
  const query: Record<string, string> = {};
  if (filters?.imps) query.imps = "true";
  if (filters?.neft) query.neft = "true";
  if (filters?.popular) query.popular = "true";
  if (filters?.search) query.search = filters.search;

  const r = await samedayRequest<{
    success: boolean;
    banks?: Array<{
      id: number;
      name: string;
      ifsc_prefix: string;
      imps: boolean;
      neft: boolean;
    }>;
    total?: number;
  }>(
    creds(),
    "GET",
    `${P}/banks`,
    undefined,
    Object.keys(query).length ? query : undefined
  );

  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      banks: (r.data.banks ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        ifscPrefix: b.ifsc_prefix,
        imps: b.imps,
        neft: b.neft,
      })),
      total: r.data.total ?? 0,
    },
    raw: r.raw,
  };
}

// ---------------------------------------------------------------------------
// 3. VERIFY BANK ACCOUNT  (eKYC Hub penny-less, ₹4.72 on success only)
// ---------------------------------------------------------------------------

export async function knteerVerifyAccount(input: {
  accountNumber: string;
  ifscCode: string;
  bankName?: string;
}): Promise<PartnerResult<KnteerVerifyResult>> {
  log.info(
    { accountLast4: input.accountNumber.slice(-4), ifsc: input.ifscCode },
    "KnteerPayout verify account"
  );

  const r = await samedayRequest<{
    success: boolean;
    is_valid?: boolean;
    account_holder_name?: string | null;
    bank_name?: string | null;
    branch_name?: string | null;
    verification_charges?: number;
    message?: string;
    reference_id?: string | null;
    error?: { code?: string; message?: string };
  }>(
    creds(),
    "POST",
    `${P}/verify`,
    {
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode,
      ...(input.bankName ? { bankName: input.bankName } : {}),
    },
    undefined,
    { audit: true }
  );

  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      isValid: r.data.is_valid ?? false,
      accountHolderName: r.data.account_holder_name ?? null,
      bankName: r.data.bank_name ?? null,
      branchName: r.data.branch_name ?? null,
      verificationCharges: r.data.verification_charges ?? 0,
      referenceId: r.data.reference_id ?? null,
      message: r.data.message ?? "",
    },
    raw: r.raw,
  };
}

// ---------------------------------------------------------------------------
// 4. REGISTER BANK ACCOUNT  (₹4.72 one-time, idempotent for already-registered)
// ---------------------------------------------------------------------------

export async function knteerRegisterAccount(input: {
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
  mobile: string;
  email?: string;
  registrationType?: "register" | "verify";
}): Promise<PartnerResult<KnteerRegisterResult>> {
  log.info(
    {
      accountLast4: input.accountNumber.slice(-4),
      ifsc: input.ifscCode,
      registrationType: input.registrationType ?? "register",
    },
    "KnteerPayout register account"
  );

  const r = await samedayRequest<{
    success: boolean;
    already_registered?: boolean;
    registration_type?: string;
    verification_charge?: number;
    reference_id?: string | null;
    message?: string;
    account?: {
      account_number?: string;
      ifsc_code?: string;
      account_holder_name?: string;
      bank_name?: string;
      is_registered?: boolean;
      is_bank_verified?: boolean;
    };
  }>(
    creds(),
    "POST",
    `${P}/accounts`,
    {
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode,
      accountHolderName: input.accountHolderName,
      bankName: input.bankName,
      mobile: input.mobile,
      ...(input.email ? { email: input.email } : {}),
      registration_type: input.registrationType ?? "register",
    },
    undefined,
    { audit: true }
  );

  if (!r.ok) return r;
  const acc = r.data.account ?? {};
  return {
    ok: true,
    data: {
      alreadyRegistered: r.data.already_registered ?? false,
      registrationType: (r.data.registration_type ?? "register") as "register" | "verify",
      verificationCharge: r.data.verification_charge ?? 0,
      referenceId: r.data.reference_id ?? null,
      message: r.data.message ?? "",
      account: {
        accountNumber: acc.account_number ?? "",
        ifscCode: acc.ifsc_code ?? input.ifscCode,
        accountHolderName: acc.account_holder_name ?? input.accountHolderName,
        bankName: acc.bank_name ?? input.bankName,
        isRegistered: acc.is_registered ?? true,
        isBankVerified: acc.is_bank_verified ?? false,
      },
    },
    raw: r.raw,
  };
}

// ---------------------------------------------------------------------------
// 5. LIST REGISTERED ACCOUNTS
// ---------------------------------------------------------------------------

export async function knteerListAccounts(): Promise<PartnerResult<KnteerListAccount[]>> {
  const r = await samedayRequest<{
    success: boolean;
    accounts?: Array<{
      id: string;
      account_number: string;
      ifsc_code: string;
      account_holder_name: string;
      bank_name: string;
      mobile: string;
      is_registered: boolean;
      created_at: string;
    }>;
  }>(creds(), "GET", `${P}/accounts`);

  if (!r.ok) return r;
  return {
    ok: true,
    data: (r.data.accounts ?? []).map((a) => ({
      id: a.id,
      accountNumber: a.account_number,
      ifscCode: a.ifsc_code,
      accountHolderName: a.account_holder_name,
      bankName: a.bank_name,
      mobile: a.mobile,
      isRegistered: a.is_registered,
      createdAt: a.created_at,
    })),
    raw: r.raw,
  };
}

// ---------------------------------------------------------------------------
// 6. INITIATE TRANSFER  (account must be pre-registered via /accounts)
// ---------------------------------------------------------------------------

export async function knteerTransfer(
  input: {
    accountNumber: string;
    ifscCode: string;
    accountHolderName: string;
    bankName: string;
    mobile: string;
    amount: number;
    email?: string;
    paymentMode?: "IMPS" | "NEFT";
    remarks?: string;
  },
  idempotencyKey?: string
): Promise<PartnerResult<KnteerTransferResult>> {
  log.info(
    {
      accountLast4: input.accountNumber.slice(-4),
      amount: input.amount,
      paymentMode: input.paymentMode ?? "IMPS",
    },
    "KnteerPayout transfer initiated"
  );

  const body: Record<string, unknown> = {
    accountNumber: input.accountNumber,
    ifscCode: input.ifscCode,
    accountHolderName: input.accountHolderName,
    bankName: input.bankName,
    mobile: input.mobile,
    amount: input.amount,
    paymentMode: input.paymentMode ?? "IMPS",
  };
  if (input.email) body.email = input.email;
  if (input.remarks) body.remarks = input.remarks;

  // Idempotency header — samedayRequest merges extra headers via the fetch call.
  // We pass it via the standard SamedayRequestOpts; the core already adds auth
  // headers, so we build an extra-headers shim below.
  // NOTE: sameday-core does not currently accept per-call extra headers. We use
  // a lightweight wrapper that pre-injects the idempotency key into the body
  // as a noop field (providers ignore unknown fields) OR we extend the core in
  // a follow-up. For now, the partner's own 60-second cooldown + our
  // idempotent DB upsert (via transactionId PK) prevent double-debit on retries.

  const r = await samedayRequest<{
    success: boolean;
    message?: string;
    transaction_id?: string;
    partner_trans_id?: string;
    knteer_trans_id?: string;
    utr?: string | null;
    status?: string;
    amount?: number;
    charges?: number;
    total_debited?: number;
    payment_mode?: string;
    account_number?: string;
    account_holder_name?: string;
    bank_name?: string;
    remarks?: string | null;
    created_at?: string;
    created_at_ist?: string;
    completed_at?: string | null;
    completed_at_ist?: string | null;
    // Error extras for TRANSFER_IN_PROGRESS
    existing_transaction_id?: string;
    existing_partner_trans_id?: string;
    existing_amount?: number;
    error?: { code?: string; message?: string };
  }>(creds(), "POST", `${P}/transfer`, body, undefined, { audit: true });

  if (!r.ok) {
    log.warn(
      { code: r.code, accountLast4: input.accountNumber.slice(-4), amount: input.amount },
      "KnteerPayout transfer failed"
    );
    return r;
  }

  const status = normalizeKnteerStatus(r.data.status);

  log.info(
    {
      transactionId: r.data.transaction_id ?? "",
      status,
      amount: r.data.amount ?? input.amount,
    },
    "KnteerPayout transfer response"
  );

  return {
    ok: true,
    data: {
      transactionId: r.data.transaction_id ?? "",
      partnerTransId: r.data.partner_trans_id ?? "",
      knteerTransId: r.data.knteer_trans_id ?? "",
      utr: r.data.utr ?? null,
      status,
      amount: r.data.amount ?? input.amount,
      charges: r.data.charges ?? 0,
      totalDebited: r.data.total_debited ?? input.amount,
      paymentMode: r.data.payment_mode ?? input.paymentMode ?? "IMPS",
      accountNumber: r.data.account_number ?? "",
      accountHolderName: r.data.account_holder_name ?? input.accountHolderName,
      bankName: r.data.bank_name ?? input.bankName,
      remarks: r.data.remarks ?? input.remarks ?? null,
      createdAt: r.data.created_at ?? new Date().toISOString(),
      createdAtIst: r.data.created_at_ist ?? "",
      completedAt: r.data.completed_at ?? null,
      completedAtIst: r.data.completed_at_ist ?? null,
    },
    partnerTxnId: r.data.transaction_id,
    pending: status === "PENDING",
    raw: r.raw,
  };
}

// ---------------------------------------------------------------------------
// 7. CHECK TRANSACTION STATUS
// ---------------------------------------------------------------------------

export async function knteerCheckStatus(ref: {
  transactionId?: string;
  partnerTransId?: string;
}): Promise<PartnerResult<KnteerTransaction>> {
  const query: Record<string, string> = {};
  if (ref.transactionId) query.transactionId = ref.transactionId;
  else if (ref.partnerTransId) query.partnerTransId = ref.partnerTransId;
  else
    return {
      ok: false,
      code: "BAD_PARAMS",
      message: "transactionId or partnerTransId required",
    };

  const r = await samedayRequest<{
    success: boolean;
    transaction?: {
      transaction_id?: string;
      partner_trans_id?: string;
      knteer_trans_id?: string;
      utr?: string | null;
      status?: string;
      amount?: number;
      charges?: number;
      total_debited?: number;
      payment_mode?: string;
      account_number?: string;
      account_holder_name?: string;
      bank_name?: string;
      ifsc_code?: string;
      remarks?: string | null;
      created_at?: string;
      created_at_ist?: string;
      completed_at?: string | null;
      completed_at_ist?: string | null;
    };
  }>(creds(), "GET", `${P}/status`, undefined, query);

  if (!r.ok) return r;
  const t = r.data.transaction ?? {};
  return {
    ok: true,
    data: {
      transactionId: t.transaction_id ?? "",
      partnerTransId: t.partner_trans_id ?? "",
      knteerTransId: t.knteer_trans_id ?? "",
      utr: t.utr ?? null,
      status: normalizeKnteerStatus(t.status),
      amount: t.amount ?? 0,
      charges: t.charges ?? 0,
      totalDebited: t.total_debited ?? 0,
      paymentMode: t.payment_mode ?? "IMPS",
      accountNumber: t.account_number ?? "",
      accountHolderName: t.account_holder_name ?? "",
      bankName: t.bank_name ?? "",
      ifscCode: t.ifsc_code ?? "",
      remarks: t.remarks ?? null,
      createdAt: t.created_at ?? "",
      createdAtIst: t.created_at_ist ?? "",
      completedAt: t.completed_at ?? null,
      completedAtIst: t.completed_at_ist ?? null,
    },
    raw: r.raw,
  };
}

// ---------------------------------------------------------------------------
// 8. LIST TRANSACTIONS
// ---------------------------------------------------------------------------

export async function knteerListTransactions(
  limit = 20
): Promise<PartnerResult<KnteerTransaction[]>> {
  const r = await samedayRequest<{
    success: boolean;
    transactions?: Array<Record<string, unknown>>;
  }>(creds(), "GET", `${P}/status`, undefined, {
    list: "true",
    limit: String(Math.min(limit, 50)),
  });

  if (!r.ok) return r;
  const txns: KnteerTransaction[] = (r.data.transactions ?? []).map((t) => ({
    transactionId: String(t.transaction_id ?? ""),
    partnerTransId: String(t.partner_trans_id ?? ""),
    knteerTransId: String(t.knteer_trans_id ?? ""),
    utr: t.utr ? String(t.utr) : null,
    status: normalizeKnteerStatus(String(t.status ?? "")),
    amount: Number(t.amount ?? 0),
    charges: Number(t.charges ?? 0),
    totalDebited: Number(t.total_debited ?? 0),
    paymentMode: String(t.payment_mode ?? "IMPS"),
    accountNumber: String(t.account_number ?? ""),
    accountHolderName: String(t.account_holder_name ?? ""),
    bankName: String(t.bank_name ?? ""),
    ifscCode: String(t.ifsc_code ?? ""),
    remarks: t.remarks ? String(t.remarks) : null,
    createdAt: String(t.created_at ?? ""),
    createdAtIst: String(t.created_at_ist ?? ""),
    completedAt: t.completed_at ? String(t.completed_at) : null,
    completedAtIst: t.completed_at_ist ? String(t.completed_at_ist) : null,
  }));
  return { ok: true, data: txns, raw: r.raw };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeKnteerStatus(raw: string | undefined): KnteerPayoutStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "SUCCESS":
      return "SUCCESS";
    case "FAILED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

/** Knteer status → the generic payout lifecycle status. */
function knteerToPayoutStatus(s: KnteerPayoutStatus): PayoutOutput["status"] {
  if (s === "SUCCESS") return "PAID";
  if (s === "FAILED") return "FAILED";
  return "PROCESSING";
}

// ---------------------------------------------------------------------------
// PayoutProvider adapter — lets the Knteer rail ride the shared PayoutRequest
// money-safety lifecycle (hold → capture/release → NEEDS_REVIEW → recovery)
// in src/lib/payout/service.ts, selected per-row when PayoutRequest.rail="KNTEER".
// ---------------------------------------------------------------------------

export const samedayKnteerPayout: PayoutProvider = {
  name: "SAMEDAY_KNTEER",

  async payout(input) {
    if (
      input.mode === "UPI" ||
      !input.beneficiary.accountNumber ||
      !input.beneficiary.ifsc
    ) {
      return {
        ok: false,
        code: "UNSUPPORTED_MODE",
        message:
          "Bank Transfer (Knteer) supports bank transfers (IMPS/NEFT) only.",
      };
    }
    // Knteer supports IMPS + NEFT. Anything else (RTGS) falls back to IMPS.
    const paymentMode: "IMPS" | "NEFT" = input.mode === "NEFT" ? "NEFT" : "IMPS";

    const r = await knteerTransfer(
      {
        accountNumber: input.beneficiary.accountNumber,
        ifscCode: input.beneficiary.ifsc,
        accountHolderName: input.beneficiary.name,
        bankName: input.beneficiary.bankName ?? "",
        mobile: input.beneficiary.mobile ?? "",
        amount: toNumber(input.amount),
        paymentMode,
        // Embed our reference in remarks so recovery can match it later.
        remarks: input.purpose.slice(0, 100),
      },
      input.idempotencyKey
    );

    if (!r.ok) return r;

    return {
      ok: true,
      data: {
        // transaction_id is what the Knteer status endpoint accepts — persist it
        // as the provider txn id so reconciliation can poll it later.
        payoutId: r.data.transactionId,
        utr: r.data.utr ?? undefined,
        status: knteerToPayoutStatus(r.data.status),
      },
      partnerTxnId: r.data.transactionId,
      raw: r.raw,
    };
  },

  async status(payoutIdOrReference) {
    // Our internal "PO…" reference is never sent to Knteer — only the Knteer
    // transaction_id (UUID) persisted from the transfer response works.
    if (payoutIdOrReference.startsWith("PO")) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "No Knteer transaction id persisted for this payout yet",
      };
    }
    const r = await knteerCheckStatus({ transactionId: payoutIdOrReference });
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        status: knteerToPayoutStatus(r.data.status),
        utr: r.data.utr ?? undefined,
      },
      raw: r.raw,
    };
  },

  async fetchBalance() {
    const r = await knteerGetBalance();
    if (!r.ok) return r;
    return { ok: true, data: r.data.balance, raw: r.raw };
  },

  async listRecent(limit = 50) {
    const r = await knteerListTransactions(limit);
    if (!r.ok) return r;
    return {
      ok: true,
      data: r.data.map((t) => ({
        reference: t.transactionId,
        amount: t.amount,
        accountLast4:
          (t.accountNumber ?? "").replace(/\D/g, "").slice(-4) || undefined,
        utr: t.utr ?? undefined,
        status: knteerToPayoutStatus(t.status),
        createdAt: t.createdAt,
      })),
      raw: r.raw,
    };
  },
};
