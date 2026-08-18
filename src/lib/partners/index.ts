/**
 * Central partner registry. Business logic should ONLY ever import from
 * this file (or types.ts) — never from a vendor-specific adapter.
 *
 * Each vertical is resolved at request time so toggling
 * `PARTNER_*_ENABLED` does not require a rebuild.
 */
import { flags, isProd } from "../env";
import * as mock from "./mock";
import { paysprintAeps, paysprintConfigured, paysprintDmt } from "./paysprint";
import { razorpayPayout, razorpayPayoutConfigured, razorpayUpi, razorpayUpiConfigured } from "./razorpay";
import { bulkpeConfigured, bulkpePayout, bulkpeUpi } from "./bulkpe";
import { bulkpeBbps, bulkpeBbpsConfigured } from "./bulkpe-bbps";
import { samedayBbps, samedayBbpsConfigured } from "./sameday-bbps";
import { samedaySettlementConfigured } from "./sameday-settlement";
import { samedaySettlementPayout } from "./sameday-payout";
import { rechargekitConfigured } from "./sameday-rechargekit";
import { leegalityConfigured } from "./leegality";
import { msg91Configured, msg91Sms } from "./msg91";
import { resendConfigured, resendEmail } from "./resend";
import { ekychubConfigured, ekychubVerification } from "./ekychub";
import { twilioVerify, isTwilioOtpEnabled } from "./twilio";
import type {
  AepsProvider,
  BbpsProvider,
  DmtProvider,
  EmailProvider,
  OtpVerifyProvider,
  PanProvider,
  PayoutProvider,
  RechargeProvider,
  SmsProvider,
  TravelProvider,
  UpiProvider
} from "./types";

export type Vertical =
  | "aeps"
  | "dmt"
  | "upi"
  | "payout"
  | "bbps"
  | "recharge"
  | "travel"
  | "pan"
  | "sms"
  | "email"
  | "verification"
  | "otpVerify";

export type ProviderMap = {
  aeps: AepsProvider;
  dmt: DmtProvider;
  upi: UpiProvider;
  payout: PayoutProvider;
  bbps: BbpsProvider;
  recharge: RechargeProvider;
  travel: TravelProvider;
  pan: PanProvider;
  sms: SmsProvider;
  email: EmailProvider;
  verification: typeof ekychubVerification;
  otpVerify: OtpVerifyProvider;
};

/**
 * BBPS routing — two live rails, chosen per category:
 *   - Same Day BBPS-2 (Pay2New): CREDIT_CARD only (contracted rail, kept
 *     preferred for CC when configured).
 *   - BulkPe BBPS: all categories (electricity, water, gas, CC, ...).
 * When both are configured we dispatch per call on `input.category`; with a
 * single rail configured that rail serves everything it can; otherwise MOCK.
 */
function resolveBbps(): BbpsProvider {
  const sameday = flags.bbps && samedayBbpsConfigured();
  const bulkpe = flags.bbpsBulkpe && bulkpeBbpsConfigured();
  if (sameday && bulkpe) {
    const pick = (category: string) => (category === "CREDIT_CARD" ? samedayBbps : bulkpeBbps);
    return {
      name: "BBPS_ROUTED",
      fetchBill: (input) => pick(input.category).fetchBill(input),
      pay: (input) => pick(input.category).pay(input),
      billers: (category) => pick(category).billers!(category),
      // Status lookups can't see the category; BulkPe transaction ids are
      // "BBPS…"-prefixed, Same Day order ids are not.
      status: (ref) =>
        (ref.orderId?.startsWith("BBPS") ? bulkpeBbps : samedayBbps).status!(ref),
    };
  }
  if (sameday) return samedayBbps;
  if (bulkpe) return bulkpeBbps;
  return mock.mockBbps;
}

/**
 * Payout routing — bank transfers (IMPS/NEFT/RTGS) prefer the Same Day
 * Settlement rail (partner wallet → penny-drop-verified accounts); UPI
 * payouts can only ride BulkPe (or RazorpayX). With a single rail configured
 * that rail serves what it can; otherwise MOCK.
 */
function resolvePayout(): PayoutProvider {
  if (!flags.payout) return mock.mockPayout;
  const sameday = samedaySettlementConfigured();
  const upiRail = bulkpeConfigured()
    ? bulkpePayout
    : razorpayPayoutConfigured()
      ? razorpayPayout
      : null;
  if (sameday && upiRail) {
    return {
      name: "PAYOUT_ROUTED",
      payout: (input) => (input.mode === "UPI" ? upiRail : samedaySettlementPayout).payout(input),
      // Status lookups can't see the mode. Our own reference ids ("PO…")
      // only resolve at BulkPe/Razorpay; anything else is tried at Same Day
      // first, falling back to the UPI rail's lookup.
      status: async (ref) => {
        if (ref.startsWith("PO")) return upiRail.status(ref);
        const r = await samedaySettlementPayout.status(ref);
        return r.ok ? r : upiRail.status(ref);
      },
      fetchBalance: () => samedaySettlementPayout.fetchBalance!(),
    };
  }
  if (sameday) return samedaySettlementPayout;
  if (upiRail) return upiRail;
  return mock.mockPayout;
}

export function getPartner<V extends Vertical>(v: V): ProviderMap[V] {
  switch (v) {
    case "aeps":
      return (flags.aeps && paysprintConfigured() ? paysprintAeps : mock.mockAeps) as ProviderMap[V];
    case "dmt":
      return (flags.dmt && paysprintConfigured() ? paysprintDmt : mock.mockDmt) as ProviderMap[V];
    case "upi":
      // Prefer BulkPe Simple PG; fall back to Razorpay when only that is configured.
      if (flags.upi && bulkpeConfigured()) return bulkpeUpi as ProviderMap[V];
      if (flags.upi && razorpayUpiConfigured()) return razorpayUpi as ProviderMap[V];
      return mock.mockUpi as ProviderMap[V];
    case "payout":
      return resolvePayout() as ProviderMap[V];
    case "bbps":
      return resolveBbps() as ProviderMap[V];
    case "recharge":
      return mock.mockRecharge as ProviderMap[V]; // wire RechargeAPI / PaySprint
    case "travel":
      return mock.mockTravel as ProviderMap[V]; // wire Tripjack / TBO
    case "pan":
      return mock.mockPan as ProviderMap[V]; // wire NSDL e-Gov
    case "sms":
      return (flags.sms && msg91Configured() ? msg91Sms : mock.mockSms) as ProviderMap[V];
    case "email":
      return (flags.email && resendConfigured() ? resendEmail : mock.mockEmail) as ProviderMap[V];
    case "verification":
      if (!flags.verification || !ekychubConfigured()) {
        throw new Error("Verification partner (eKYC Hub) is not configured. Set PARTNER_VERIFICATION_ENABLED=true and add EKYCHUB_USERNAME/EKYCHUB_API_TOKEN.");
      }
      return ekychubVerification as ProviderMap[V];
    case "otpVerify":
      if (!isTwilioOtpEnabled()) {
        throw new Error("Twilio Verify is not configured. Set PARTNER_OTP_PROVIDER=twilio and add TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_VERIFY_SERVICE_SID.");
      }
      return twilioVerify as unknown as ProviderMap[V];
  }
  throw new Error(`Unknown vertical: ${v as string}`);
}

/**
 * True when a resolved provider is a mock/stub adapter (its name is prefixed
 * `MOCK-`). Mock adapters simulate success without moving real money, so any
 * money-crediting rail MUST refuse to settle through one in production — see
 * `assertRealMoneyProvider`.
 */
export function isMockProvider(p: { name: string }): boolean {
  return p.name.toUpperCase().startsWith("MOCK");
}

/**
 * Guard for money-crediting rails (wallet top-up, payin capture): refuse to
 * proceed when the resolved provider is a mock and we are running in production.
 * This makes it physically impossible to mint wallet balance without a real
 * collector, even if a `PARTNER_*_ENABLED` flag is misconfigured. Throws the
 * caller-supplied error so each rail can surface its own message/status.
 */
export function assertRealMoneyProvider(p: { name: string }, makeError: () => Error): void {
  if (isProd && isMockProvider(p)) throw makeError();
}

/**
 * Verticals that move REAL money. A mock adapter on any of these simulates
 * success without a bank/PSP actually moving funds, so in production every one
 * of these MUST resolve to a real provider:
 *   - `upi`    mints wallet balance on a "PAID" collection (self-funding risk)
 *   - `payout` / `aeps` / `dmt` / `bbps` push money OUT (phantom "success")
 * See `moneyRailsOnMock` for the deployment tripwire that enforces this.
 */
export const MONEY_VERTICALS = ["upi", "payout", "aeps", "dmt", "bbps"] as const;

/**
 * Returns the money verticals currently backed by a MOCK adapter (e.g.
 * `["upi"]`); empty when every money rail is real. The root cause of the
 * phantom-balance incident was a money rail silently running on a mock in
 * production, so this is surfaced by the startup tripwire (`src/instrumentation.ts`)
 * and `/api/healthz` — a misconfigured mock can never hide again.
 */
export function moneyRailsOnMock(): Vertical[] {
  const onMock: Vertical[] = [];
  for (const v of MONEY_VERTICALS) {
    try {
      if (isMockProvider(getPartner(v))) onMock.push(v);
    } catch {
      // A vertical that throws to resolve is, by definition, not a live mock.
    }
  }
  return onMock;
}

/** For /api/healthz and the admin "Integrations" page. */
export function partnerStatus() {
  return {
    aeps:     { live: flags.aeps && paysprintConfigured(), provider: flags.aeps && paysprintConfigured() ? "PAYSPRINT" : "MOCK" },
    dmt:      { live: flags.dmt && paysprintConfigured(), provider: flags.dmt && paysprintConfigured() ? "PAYSPRINT" : "MOCK" },
    upi:      { live: flags.upi && (bulkpeConfigured() || razorpayUpiConfigured()), provider: flags.upi && bulkpeConfigured() ? "BULKPE_PG" : flags.upi && razorpayUpiConfigured() ? "RAZORPAY" : "MOCK" },
    payout:   (() => {
      const p = resolvePayout();
      const live = p.name !== "MOCK-PAYOUT";
      return { live, provider: !live ? "MOCK" : p.name === "PAYOUT_ROUTED" ? "SAMEDAY_SETTLEMENT+BULKPE" : p.name };
    })(),
    bbps:     (() => {
      const p = resolveBbps();
      const live = p.name !== "MOCK-BBPS";
      return { live, provider: !live ? "MOCK" : p.name === "BBPS_ROUTED" ? "SAMEDAY_PAY2NEW+BULKPE_BBPS" : p.name };
    })(),
    recharge: { live: false, provider: "MOCK" },
    travel:   { live: false, provider: "MOCK" },
    pan:      { live: false, provider: "MOCK" },
    sms:      { live: flags.sms && msg91Configured(), provider: flags.sms && msg91Configured() ? "MSG91" : "MOCK" },
    email:    { live: flags.email && resendConfigured(), provider: flags.email && resendConfigured() ? "RESEND" : "MOCK" },
    verification: { live: flags.verification && ekychubConfigured(), provider: flags.verification && ekychubConfigured() ? "EKYCHUB" : "NONE" },
    otpVerify: { live: isTwilioOtpEnabled(), provider: isTwilioOtpEnabled() ? "TWILIO_VERIFY" : "NONE" },
    settlement: { live: flags.settlement && samedaySettlementConfigured(), provider: flags.settlement && samedaySettlementConfigured() ? "SAMEDAY" : "NONE" },
    rechargekit: { live: flags.rechargekit && rechargekitConfigured(), provider: flags.rechargekit && rechargekitConfigured() ? "SAMEDAY_RECHARGEKIT" : "NONE" },
    esign:    { live: flags.esign && leegalityConfigured(), provider: flags.esign && leegalityConfigured() ? "LEEGALITY" : "NONE" }
  };
}

export type * from "./types";
