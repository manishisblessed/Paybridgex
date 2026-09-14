import { describe, expect, it } from "vitest";
import {
  DEFAULT_RISK_LIMITS,
  evaluateRisk,
  isNightWindowIST,
  type RiskLimits,
} from "@/lib/risk/engine";
import { parseServiceCaps } from "@/lib/risk/limits";

/**
 * Pure rule-evaluation tests for the transaction risk engine. The DB wrapper
 * is exercised via the runTransaction tests; here we pin down the exact rule
 * boundaries so a limit change is always a deliberate edit.
 */

const limits: RiskLimits = { ...DEFAULT_RISK_LIMITS };

// 12:00 UTC = 17:30 IST (day window); 20:00 UTC = 01:30 IST (night window).
const DAY = new Date("2026-07-01T12:00:00Z");
const NIGHT = new Date("2026-07-01T20:00:00Z");

function input(overrides: Partial<Parameters<typeof evaluateRisk>[0]> = {}) {
  return {
    amount: 1000,
    service: "DMT_IMPS",
    now: DAY,
    amount24h: 0,
    txnCount1h: 0,
    limits,
    ...overrides,
  };
}

describe("isNightWindowIST", () => {
  it("identifies the 00:00–06:00 IST window", () => {
    expect(isNightWindowIST(NIGHT)).toBe(true); // 01:30 IST
    expect(isNightWindowIST(DAY)).toBe(false); // 17:30 IST
    expect(isNightWindowIST(new Date("2026-07-01T00:29:00Z"))).toBe(true); // 05:59 IST
    expect(isNightWindowIST(new Date("2026-07-01T00:31:00Z"))).toBe(false); // 06:01 IST
  });
});

describe("DAILY_AMOUNT_CAP", () => {
  it("allows up to the cap and blocks past it", () => {
    expect(
      evaluateRisk(input({ amount: 100_000, amount24h: 400_000 }))
    ).toHaveLength(0); // exactly at 500k
    const v = evaluateRisk(input({ amount: 100_001, amount24h: 400_000 }));
    expect(v.map((x) => x.rule)).toContain("DAILY_AMOUNT_CAP");
  });

  it("counts existing 24h exposure, not just this transaction", () => {
    const v = evaluateRisk(input({ amount: 1, amount24h: 500_000 }));
    expect(v.map((x) => x.rule)).toContain("DAILY_AMOUNT_CAP");
  });
});

describe("NIGHT_AMOUNT_CAP", () => {
  it("halves the daily cap between 00:00 and 06:00 IST", () => {
    // 250k effective cap at night with the default 0.5 factor
    expect(evaluateRisk(input({ now: NIGHT, amount: 250_000 }))).toHaveLength(0);
    const v = evaluateRisk(input({ now: NIGHT, amount: 250_001 }));
    expect(v.map((x) => x.rule)).toContain("NIGHT_AMOUNT_CAP");
  });

  it("the same amount passes during the day", () => {
    expect(evaluateRisk(input({ now: DAY, amount: 250_001 }))).toHaveLength(0);
  });
});

describe("HOURLY_VELOCITY", () => {
  it("blocks the transaction that exceeds the hourly count", () => {
    expect(evaluateRisk(input({ txnCount1h: limits.hourlyTxnCap - 1 }))).toHaveLength(0);
    const v = evaluateRisk(input({ txnCount1h: limits.hourlyTxnCap }));
    expect(v.map((x) => x.rule)).toContain("HOURLY_VELOCITY");
  });
});

describe("NEW_BENEFICIARY_CAP", () => {
  it("caps first payouts to a beneficiary inside the cooling window", () => {
    expect(
      evaluateRisk(input({ isNewBeneficiary: true, amount: limits.newBeneficiaryCap }))
    ).toHaveLength(0);
    const v = evaluateRisk(
      input({ isNewBeneficiary: true, amount: limits.newBeneficiaryCap + 1 })
    );
    expect(v.map((x) => x.rule)).toContain("NEW_BENEFICIARY_CAP");
  });

  it("does not apply to known beneficiaries", () => {
    expect(
      evaluateRisk(input({ isNewBeneficiary: false, amount: 100_000 }))
    ).toHaveLength(0);
  });
});

describe("parseServiceCaps", () => {
  it("keeps valid non-negative numbers (incl. 0 = disabled)", () => {
    expect(parseServiceCaps({ BILL_CREDIT_CARD: 100000, PAYOUT: 0 })).toEqual({
      BILL_CREDIT_CARD: 100000,
      PAYOUT: 0,
    });
  });

  it("coerces numeric strings and drops invalid / negative values", () => {
    expect(
      parseServiceCaps({ PAYOUT: "50000", DMT_IMPS: -1, X: "abc", Y: null })
    ).toEqual({ PAYOUT: 50000 });
  });

  it("returns an empty map for non-object input", () => {
    expect(parseServiceCaps(null)).toEqual({});
    expect(parseServiceCaps([1, 2])).toEqual({});
    expect(parseServiceCaps("nope")).toEqual({});
  });
});

describe("SERVICE_DAILY_CAP (per-rail tier cap)", () => {
  it("allows up to the per-service cap and blocks past it", () => {
    // Overall cap is fine (well under 500k); only the service cap bites.
    expect(
      evaluateRisk(input({ amount: 20_000, serviceCap: 100_000, serviceAmount24h: 80_000 }))
    ).toHaveLength(0); // exactly at 100k
    const v = evaluateRisk(
      input({ amount: 20_001, serviceCap: 100_000, serviceAmount24h: 80_000 })
    );
    expect(v.map((x) => x.rule)).toContain("SERVICE_DAILY_CAP");
  });

  it("does not apply when no service cap is set", () => {
    expect(
      evaluateRisk(input({ amount: 400_000, serviceCap: null, serviceAmount24h: 0 }))
    ).toHaveLength(0);
  });

  it("blocks a disabled rail (cap 0) for any positive amount", () => {
    const v = evaluateRisk(input({ amount: 1, serviceCap: 0 }));
    expect(v.map((x) => x.rule)).toContain("SERVICE_DISABLED");
  });

  it("halves the per-service cap at night", () => {
    // 100k service cap → 50k effective at night.
    expect(
      evaluateRisk(input({ now: NIGHT, amount: 50_000, serviceCap: 100_000 }))
    ).toHaveLength(0);
    const v = evaluateRisk(input({ now: NIGHT, amount: 50_001, serviceCap: 100_000 }));
    expect(v.map((x) => x.rule)).toContain("NIGHT_SERVICE_CAP");
  });

  it("is independent of the overall cap", () => {
    // Under the service cap but over the overall daily cap → overall rule fires.
    const v = evaluateRisk(
      input({ amount: 100_000, amount24h: 450_000, serviceCap: 500_000, serviceAmount24h: 0 })
    );
    const rules = v.map((x) => x.rule);
    expect(rules).toContain("DAILY_AMOUNT_CAP");
    expect(rules).not.toContain("SERVICE_DAILY_CAP");
  });
});

describe("multiple violations", () => {
  it("reports every violated rule", () => {
    const v = evaluateRisk(
      input({
        amount: 600_000,
        txnCount1h: 100,
        isNewBeneficiary: true,
        serviceCap: 100_000,
        serviceAmount24h: 50_000,
      })
    );
    const rules = v.map((x) => x.rule);
    expect(rules).toContain("DAILY_AMOUNT_CAP");
    expect(rules).toContain("HOURLY_VELOCITY");
    expect(rules).toContain("NEW_BENEFICIARY_CAP");
    expect(rules).toContain("SERVICE_DAILY_CAP");
  });
});
