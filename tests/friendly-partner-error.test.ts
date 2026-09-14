import { describe, expect, it } from "vitest";
import {
  friendlyPartnerError,
  isSensitivePartnerCode,
} from "@/lib/partners/friendlyError";

/**
 * The user-facing error boundary: no raw partner text, no internal state
 * (partner float / auth / config) may ever reach an end user. These tests pin
 * down that contract so a future partner code can't quietly start leaking.
 */
describe("friendlyPartnerError", () => {
  it("never exposes the partner float / low-balance state (company image)", () => {
    // This is OUR Same Day wallet being low, NOT the retailer's — must be hidden.
    const msg = friendlyPartnerError(
      "INSUFFICIENT_BALANCE",
      "Insufficient partner wallet balance",
      "payment"
    );
    expect(msg).not.toMatch(/partner/i);
    expect(msg).not.toMatch(/insufficient/i);
    expect(msg).toMatch(/refund/i); // reassures the retailer their money is safe
  });

  it("treats float/auth/config codes as sensitive", () => {
    for (const code of [
      "INSUFFICIENT_BALANCE",
      "LOW_BALANCE",
      "WALLET_FROZEN",
      "UNAUTHORIZED",
      "INVALID_SIGNATURE",
      "IP_NOT_WHITELISTED",
      "NOT_CONFIGURED",
    ]) {
      expect(isSensitivePartnerCode(code)).toBe(true);
    }
    expect(isSensitivePartnerCode("RATE_LIMITED")).toBe(false);
    expect(isSensitivePartnerCode(undefined)).toBe(false);
    expect(isSensitivePartnerCode(null)).toBe(false);
  });

  it("cleans up the operator-restriction message (no raw '(code 1)')", () => {
    const msg = friendlyPartnerError(
      "1",
      "Recharge amount restricted by operator (code 1)",
      "payment"
    );
    expect(msg).not.toMatch(/code 1/i);
    expect(msg).not.toMatch(/recharge amount restricted/i);
    expect(msg).toMatch(/operator/i);
  });

  it("maps known codes to specific, actionable guidance", () => {
    expect(friendlyPartnerError("RATE_LIMITED", "429")).toMatch(/busy|try again/i);
    expect(friendlyPartnerError("NETWORK", "ECONNRESET")).toMatch(/network|connection/i);
    expect(friendlyPartnerError("INVALID_MOBILE", "bad")).toMatch(/mobile/i);
    expect(friendlyPartnerError("INVALID_CARD", "bad")).toMatch(/card/i);
  });

  it("surfaces useful amount-limit feedback without raw text", () => {
    const lo = friendlyPartnerError("2", "Amount below minimum allowed of 100");
    expect(lo).toMatch(/minimum|higher/i);
    const hi = friendlyPartnerError("3", "Amount exceeds maximum limit");
    expect(hi).toMatch(/maximum|lower/i);
  });

  it("falls back to a safe default for unknown codes and junk messages", () => {
    const msg = friendlyPartnerError("WEIRD_CODE_99", "0xDEADBEEF stacktrace...");
    expect(msg).not.toMatch(/0xDEADBEEF|stacktrace/i);
    expect(msg).toMatch(/try again/i);
  });

  it("never echoes the raw message even when it looks clean", () => {
    const raw = "SomeProviderInternalStateThatShouldNotLeak";
    const msg = friendlyPartnerError("UNKNOWN", raw, "payment");
    expect(msg).not.toContain(raw);
  });

  it("tunes wording to the flow context", () => {
    expect(friendlyPartnerError("UNKNOWN", "x", "payment")).toMatch(/wallet/i);
    expect(friendlyPartnerError("UNKNOWN", "x", "payout")).toMatch(/money is safe|payout/i);
    expect(friendlyPartnerError("UNKNOWN", "x", "fetch")).toMatch(/load|try again/i);
    expect(friendlyPartnerError("UNKNOWN", "x", "generic")).toMatch(/went wrong|try again/i);
  });
});
