import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { logSecurityEvent } from "./audit";
import type { SessionUser } from "../auth-server";

/**
 * Transaction PIN — a 4–6 digit PIN verified at the moment of EVERY
 * money-moving action (bill pay, recharge, DMT, AePS withdraw, PAN apply,
 * payout submit). Distinct from the login password (long, typed rarely) and
 * 2FA (device-bound): the PIN is cheap to enter on each transaction and
 * blunts walk-up abuse of an unlocked terminal or a hijacked session.
 *
 * Rules:
 *   - Users without a PIN are refused money actions with TXN_PIN_NOT_SET
 *     (412) until they set one — the client redirects to PIN setup.
 *   - 5 wrong attempts locks PIN entry for 15 minutes (per user, in DB, so
 *     it survives restarts and horizontal scale).
 *   - The PIN travels ONLY in the `x-txn-pin` request header — never in the
 *     JSON body — so it can never leak into persisted request/audit JSON.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
export const TXN_PIN_RE = /^\d{4,6}$/;

export class TxnPinError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code:
      | "TXN_PIN_NOT_SET"
      | "TXN_PIN_REQUIRED"
      | "TXN_PIN_INVALID"
      | "TXN_PIN_LOCKED"
      | "TXN_PIN_BAD_FORMAT",
    public retryAfterSec?: number
  ) {
    super(message);
    this.name = "TxnPinError";
  }
}

/** Read the PIN from the request header (the only accepted transport). */
export function readTxnPin(req: Request): string | undefined {
  return req.headers.get("x-txn-pin")?.trim() || undefined;
}

export type TxnPinOptions = {
  action: string; // for audit, e.g. "bbps.pay"
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Verify the user's transaction PIN or throw {@link TxnPinError}:
 *   - 412 TXN_PIN_NOT_SET   — no PIN configured yet (client → setup flow)
 *   - 401 TXN_PIN_REQUIRED  — no `x-txn-pin` header supplied
 *   - 423 TXN_PIN_LOCKED    — too many wrong attempts, retry later
 *   - 401 TXN_PIN_INVALID   — wrong PIN (attempt counted)
 */
export async function requireTxnPin(user: SessionUser, req: Request, opts: TxnPinOptions): Promise<void> {
  const pin = readTxnPin(req);
  if (!pin) {
    // Distinguish "no PIN configured" from "PIN not supplied" so the client can
    // route the user to setup vs. prompt for entry. Requires a cheap existence
    // check before we can tell them apart.
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { txnPinHash: true },
    });
    if (!dbUser?.txnPinHash) {
      throw new TxnPinError(
        "Set your transaction PIN in Settings before making transactions.",
        412,
        "TXN_PIN_NOT_SET"
      );
    }
    throw new TxnPinError("Transaction PIN required.", 401, "TXN_PIN_REQUIRED");
  }

  await verifyUserPin(user.id, pin, {
    action: opts.action,
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
}

export type VerifyUserPinOptions = {
  action: string; // for audit, e.g. "auth.pin_login"
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Core transaction-PIN verification, independent of HTTP transport. Verifies
 * `pin` against the user's stored hash with the SAME failure-counting and
 * lockout semantics as {@link requireTxnPin}. Reused by TPIN login so the login
 * path benefits from the shared 5-attempt / 15-minute lockout. Throws
 * {@link TxnPinError} on not-set / locked / invalid.
 */
export async function verifyUserPin(
  userId: string,
  pin: string,
  opts: VerifyUserPinOptions
): Promise<void> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { txnPinHash: true, txnPinFailedAttempts: true, txnPinLockedUntil: true },
  });

  if (!dbUser?.txnPinHash) {
    throw new TxnPinError(
      "Set your transaction PIN in Settings before making transactions.",
      412,
      "TXN_PIN_NOT_SET"
    );
  }

  if (dbUser.txnPinLockedUntil && dbUser.txnPinLockedUntil > new Date()) {
    const retryAfterSec = Math.ceil((dbUser.txnPinLockedUntil.getTime() - Date.now()) / 1000);
    throw new TxnPinError(
      `Transaction PIN locked after too many wrong attempts. Try again in ${Math.ceil(retryAfterSec / 60)} min.`,
      423,
      "TXN_PIN_LOCKED",
      retryAfterSec
    );
  }

  const valid = TXN_PIN_RE.test(pin) && (await bcrypt.compare(pin, dbUser.txnPinHash));
  if (!valid) {
    const attempts = dbUser.txnPinFailedAttempts + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: userId },
      data: {
        txnPinFailedAttempts: lock ? 0 : attempts,
        txnPinLockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await logSecurityEvent({
      action: "txnpin.failed",
      severity: lock ? "warn" : "info",
      userId,
      entity: "User",
      entityId: userId,
      ip: opts.ip,
      userAgent: opts.userAgent,
      meta: { action: opts.action, attempts, locked: lock },
    });
    if (lock) {
      throw new TxnPinError(
        `Transaction PIN locked for ${LOCKOUT_MINUTES} minutes after ${MAX_ATTEMPTS} wrong attempts.`,
        423,
        "TXN_PIN_LOCKED",
        LOCKOUT_MINUTES * 60
      );
    }
    throw new TxnPinError(
      `Incorrect transaction PIN. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts === 1 ? "" : "s"} left.`,
      401,
      "TXN_PIN_INVALID"
    );
  }

  // Success — reset the failure counter if it was non-zero.
  if (dbUser.txnPinFailedAttempts > 0 || dbUser.txnPinLockedUntil) {
    await prisma.user.update({
      where: { id: userId },
      data: { txnPinFailedAttempts: 0, txnPinLockedUntil: null },
    });
  }
}

/**
 * Set (first time) or change the user's transaction PIN.
 * First-time set requires the account password; change requires the current
 * PIN. Weak PINs (all same digit, straight runs) are rejected.
 */
export async function setTxnPin(
  userId: string,
  input: { newPin: string; currentPin?: string; password?: string }
): Promise<void> {
  if (!TXN_PIN_RE.test(input.newPin)) {
    throw new TxnPinError("PIN must be 4 to 6 digits.", 400, "TXN_PIN_BAD_FORMAT");
  }
  if (isWeakPin(input.newPin)) {
    throw new TxnPinError(
      "PIN is too easy to guess — avoid repeated or sequential digits.",
      400,
      "TXN_PIN_BAD_FORMAT"
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, txnPinHash: true, txnPinLockedUntil: true },
  });
  if (!dbUser) throw new TxnPinError("User not found.", 404, "TXN_PIN_INVALID");

  if (dbUser.txnPinLockedUntil && dbUser.txnPinLockedUntil > new Date()) {
    const retryAfterSec = Math.ceil((dbUser.txnPinLockedUntil.getTime() - Date.now()) / 1000);
    throw new TxnPinError(
      "PIN entry is temporarily locked. Try again later.",
      423,
      "TXN_PIN_LOCKED",
      retryAfterSec
    );
  }

  if (dbUser.txnPinHash) {
    // Change: prove knowledge of the current PIN, or fall back to the account
    // password (forgot-PIN path — same trust level as a fresh login).
    const byPin = input.currentPin ? await bcrypt.compare(input.currentPin, dbUser.txnPinHash) : false;
    const byPassword = !byPin && input.password ? await bcrypt.compare(input.password, dbUser.passwordHash) : false;
    if (!byPin && !byPassword) {
      throw new TxnPinError("Current PIN (or account password) is incorrect.", 401, "TXN_PIN_INVALID");
    }
  } else {
    // First-time set: prove the account password (defends a hijacked session
    // from silently setting its own PIN).
    const ok = input.password ? await bcrypt.compare(input.password, dbUser.passwordHash) : false;
    if (!ok) throw new TxnPinError("Account password is incorrect.", 401, "TXN_PIN_INVALID");
  }

  const hash = await bcrypt.hash(input.newPin, 12);
  await prisma.user.update({
    where: { id: userId },
    data: {
      txnPinHash: hash,
      txnPinSetAt: new Date(),
      txnPinFailedAttempts: 0,
      txnPinLockedUntil: null,
    },
  });
  await logSecurityEvent({
    action: dbUser.txnPinHash ? "txnpin.changed" : "txnpin.set",
    severity: "info",
    userId,
    entity: "User",
    entityId: userId,
  });
}

/** Reject trivially guessable PINs. Exported for tests. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 0000, 111111
  const digits = pin.split("").map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending; // 1234, 4321, 456789
}
