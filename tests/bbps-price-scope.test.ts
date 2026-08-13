import { describe, expect, it } from "vitest";
import {
  BBPS_PRICE_SCOPES,
  bbpsProvidersForService,
  bbpsServiceProviderMismatch,
  bbpsServicesForProvider,
  isBbpsServiceProviderCompatible,
} from "@/lib/services/priceScope";

const UTILITY = [
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
] as const;

describe("bbpsServicesForProvider", () => {
  it("Credit Card Bill Payment only prices BILL_CREDIT_CARD", () => {
    expect(bbpsServicesForProvider(BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD)).toEqual(["BILL_CREDIT_CARD"]);
  });

  it("Credit Card Bill Payment-2 only prices BILL_CREDIT_CARD", () => {
    expect(bbpsServicesForProvider(BBPS_PRICE_SCOPES.RECHARGEKIT_CC)).toEqual(["BILL_CREDIT_CARD"]);
  });

  it("Bharat BillPay covers utilities but not credit card", () => {
    const services = bbpsServicesForProvider(BBPS_PRICE_SCOPES.BBPS_SAMEDAY);
    expect(services).not.toContain("BILL_CREDIT_CARD");
    for (const s of UTILITY) expect(services).toContain(s);
  });

  it("Unified Bill Payment Platform covers utilities but not credit card", () => {
    const services = bbpsServicesForProvider(BBPS_PRICE_SCOPES.BBPS_BULKPE);
    expect(services).not.toContain("BILL_CREDIT_CARD");
    for (const s of UTILITY) expect(services).toContain(s);
  });

  it("unpinned / unknown provider keeps the full family (legacy any-provider slabs)", () => {
    expect(bbpsServicesForProvider(null).length).toBeGreaterThan(1);
    expect(bbpsServicesForProvider("SAMEDAY")).toContain("BILL_CREDIT_CARD");
    expect(bbpsServicesForProvider("SAMEDAY")).toContain("BILL_ELECTRICITY");
  });
});

describe("isBbpsServiceProviderCompatible", () => {
  it("rejects electricity + Credit Card Bill Payment", () => {
    expect(isBbpsServiceProviderCompatible("BILL_ELECTRICITY", BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD)).toBe(false);
    expect(bbpsServiceProviderMismatch("BILL_ELECTRICITY", BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD)).toMatch(
      /Credit Card Bill Payment/
    );
  });

  it("accepts credit card + Credit Card Bill Payment", () => {
    expect(isBbpsServiceProviderCompatible("BILL_CREDIT_CARD", BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD)).toBe(true);
    expect(bbpsServiceProviderMismatch("BILL_CREDIT_CARD", BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD)).toBeNull();
  });

  it("rejects credit card + Bharat BillPay", () => {
    expect(isBbpsServiceProviderCompatible("BILL_CREDIT_CARD", BBPS_PRICE_SCOPES.BBPS_SAMEDAY)).toBe(false);
  });

  it("rejects credit card + Unified Bill Payment Platform", () => {
    expect(isBbpsServiceProviderCompatible("BILL_CREDIT_CARD", BBPS_PRICE_SCOPES.BBPS_BULKPE)).toBe(false);
  });

  it("does not constrain payout / non-BBPS services", () => {
    expect(isBbpsServiceProviderCompatible("PAYOUT", BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD)).toBe(true);
  });
});

describe("bbpsProvidersForService", () => {
  it("credit card is served only by the dedicated CC products", () => {
    const keys = bbpsProvidersForService("BILL_CREDIT_CARD");
    expect(keys).toEqual(
      expect.arrayContaining([BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD, BBPS_PRICE_SCOPES.RECHARGEKIT_CC])
    );
    expect(keys).not.toContain(BBPS_PRICE_SCOPES.BBPS_SAMEDAY);
    expect(keys).not.toContain(BBPS_PRICE_SCOPES.BBPS_BULKPE);
  });

  it("electricity is served by Bharat BillPay and Unified, not the CC products", () => {
    const keys = bbpsProvidersForService("BILL_ELECTRICITY");
    expect(keys).toEqual(
      expect.arrayContaining([BBPS_PRICE_SCOPES.BBPS_SAMEDAY, BBPS_PRICE_SCOPES.BBPS_BULKPE])
    );
    expect(keys).not.toContain(BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD);
    expect(keys).not.toContain(BBPS_PRICE_SCOPES.RECHARGEKIT_CC);
  });
});
