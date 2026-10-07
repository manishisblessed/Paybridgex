import { describe, expect, it } from "vitest";
import {
  classifyBbpsFailure,
  recordBbpsOutcome,
  getBbpsHealthSnapshot,
} from "@/lib/services/bbpsHealth";

/**
 * The BBPS rail-health brain: one classifier decides both what a retailer sees
 * (platform-down vs bank-down vs their own typo) and when ops gets paged. These
 * tests pin the buckets so a wording/threshold change can't silently misroute an
 * outage — the exact gap that let the Oct-2026 degradation run for days.
 */
describe("classifyBbpsFailure", () => {
  it("flags a replayed, already-refunded bill_fetch_ref as a stale session (not an outage)", () => {
    expect(classifyBbpsFailure("PAYMENT_REFUNDED", "whatever")).toBe("STALE_SESSION");
    expect(
      classifyBbpsFailure(
        "X",
        "The previous payment for this bill_fetch_ref failed and was refunded. Fetch a new bill to retry."
      )
    ).toBe("STALE_SESSION");
  });

  it("treats transport / auth / float / 5xx as a platform (API) outage", () => {
    for (const c of ["NETWORK", "PARTNER_TIMEOUT", "UNAUTHORIZED", "IP_NOT_WHITELISTED", "INSUFFICIENT_BALANCE", "HTTP_500", "HTTP_503", "HTTP_429"]) {
      expect(classifyBbpsFailure(c, "")).toBe("API_DOWN");
    }
    expect(
      classifyBbpsFailure("X", "This service is temporarily down. Please drop a message to the support team.")
    ).toBe("API_DOWN");
  });

  it("treats wrong card/mobile and bad params as user error (never a rail signal)", () => {
    expect(classifyBbpsFailure("BAD_PARAMS", "")).toBe("USER_ERROR");
    expect(classifyBbpsFailure("X", "Incorrect / invalid Customer account")).toBe("USER_ERROR");
  });

  it("treats biller declines / bill-fetch failures as bank/biller down", () => {
    expect(classifyBbpsFailure("PAYMENT_FAILED", "Transaction Failed; amount refunded")).toBe("BILLER_DOWN");
    expect(classifyBbpsFailure("X", "Unable to get bill details from Biller")).toBe("BILLER_DOWN");
    // Unknown upstream failure is conservatively bank-side (we'd name our own).
    expect(classifyBbpsFailure("MYSTERY", "something odd")).toBe("BILLER_DOWN");
  });
});

describe("getBbpsHealthSnapshot", () => {
  it("stays OK below the minimum sample size", () => {
    recordBbpsOutcome({ ok: false, step: "pay", code: "NETWORK" });
    recordBbpsOutcome({ ok: false, step: "pay", code: "NETWORK" });
    expect(getBbpsHealthSnapshot().status).toBe("OK");
  });

  it("calls a platform outage when failures are API-dominated", () => {
    for (let i = 0; i < 10; i++) recordBbpsOutcome({ ok: false, step: "pay", code: "NETWORK" });
    for (let i = 0; i < 2; i++) recordBbpsOutcome({ ok: true, step: "pay" });
    const h = getBbpsHealthSnapshot();
    expect(h.status).toBe("API_DOWN");
    expect(h.reason).toMatch(/temporarily down|outage|not be charged/i);
  });

  it("marks a specific biller down and excludes stale/user noise from scoring", () => {
    // Pure noise that must NOT move the needle.
    for (let i = 0; i < 20; i++) recordBbpsOutcome({ ok: false, step: "pay", code: "PAYMENT_REFUNDED", billerCode: "NOISE" });
    for (let i = 0; i < 20; i++) recordBbpsOutcome({ ok: false, step: "fetch", code: "BAD_PARAMS", billerCode: "NOISE" });
    // A genuinely down biller.
    for (let i = 0; i < 6; i++)
      recordBbpsOutcome({ ok: false, step: "pay", code: "PAYMENT_FAILED", message: "Transaction Failed", billerCode: "AXIS_CC" });
    expect(getBbpsHealthSnapshot().downBillers).toContain("AXIS_CC");
  });
});
