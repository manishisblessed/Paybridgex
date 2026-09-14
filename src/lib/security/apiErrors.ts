import { NextResponse } from "next/server";
import { AuthError } from "../auth-server";
import { RateLimitError } from "./rateLimit";
import { AccountLockedError } from "./lockout";
import { CaptchaError } from "./captcha";
import { BreachedPasswordError } from "./breachedPassword";
import { StepUpError } from "./stepUp";
import { TxnPinError } from "./txnPin";
import { ReKycRequiredError } from "./kycGate";
import { LivenessRequiredError } from "./livenessGate";
import { AccountSuspendedError, AccountPendingApprovalError } from "./accountGate";
import { IdempotencyInProgressError } from "../idempotency";
import { ServiceDisabledError } from "../services/guard";
import { NoSchemeError } from "../scheme/gate";
import { PricingUnavailableError } from "../scheme/resolver";
import { RiskError } from "../risk/engine";
import { TopupError } from "../wallet/topup";
import { QrClaimError } from "../qr/claims";
import { DisputeError } from "../disputes/service";
import { ApiKeyError } from "../platform/apiKeys";
import { securityLogger } from "../logger";

/**
 * Central mapper from our typed errors → HTTP responses. Keeps every API route
 * consistent and prevents leaking internal error details to clients. Pass any
 * caught error; recognised security errors get their proper status code and a
 * safe message, everything else becomes a generic 500.
 */
export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
  if (e instanceof AccountLockedError) {
    return NextResponse.json(
      { error: e.message, retryAfterSec: e.retryAfterSec },
      { status: e.statusCode, headers: { "Retry-After": String(e.retryAfterSec) } }
    );
  }
  if (e instanceof RateLimitError) {
    return NextResponse.json(
      { error: e.message, retryAfterSec: e.result.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(e.result.retryAfterSec) } }
    );
  }
  if (e instanceof CaptchaError) {
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
  if (e instanceof BreachedPasswordError) {
    return NextResponse.json({ error: e.message, breached: true }, { status: e.statusCode });
  }
  if (e instanceof StepUpError) {
    return NextResponse.json(
      { error: e.message, stepUp: true, code: e.code },
      { status: e.statusCode }
    );
  }
  if (e instanceof TxnPinError) {
    return NextResponse.json(
      { error: e.message, txnPin: true, code: e.code, ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}) },
      { status: e.statusCode, ...(e.retryAfterSec ? { headers: { "Retry-After": String(e.retryAfterSec) } } : {}) }
    );
  }
  if (e instanceof ReKycRequiredError) {
    return NextResponse.json(
      { error: e.message, code: e.code, reKycDueAt: e.dueAt },
      { status: e.statusCode }
    );
  }
  if (e instanceof LivenessRequiredError) {
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: e.statusCode }
    );
  }
  if (e instanceof AccountSuspendedError) {
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: e.statusCode }
    );
  }
  if (e instanceof AccountPendingApprovalError) {
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: e.statusCode }
    );
  }
  if (e instanceof IdempotencyInProgressError) {
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
  if (e instanceof ServiceDisabledError) {
    return NextResponse.json({ error: e.message }, { status: e.statusCode });
  }
  if (e instanceof NoSchemeError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
  }
  if (e instanceof PricingUnavailableError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
  }
  if (e instanceof RiskError) {
    return NextResponse.json(
      { error: e.message, code: e.code, rule: e.rule },
      { status: e.statusCode }
    );
  }
  if (e instanceof TopupError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
  }
  if (e instanceof QrClaimError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
  }
  if (e instanceof DisputeError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
  }
  if (e instanceof ApiKeyError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
  }

  securityLogger.error({ action: "route.unhandled_error", err: String(e) });
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
