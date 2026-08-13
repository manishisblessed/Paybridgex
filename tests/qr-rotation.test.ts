import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// StaticQr.dailyLimit is a Decimal column, so build fixtures with Decimal to
// match the real row shape the rotation helpers receive (they Number()-coerce).
const dec = (n: number) => new Prisma.Decimal(n);

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/settlement/engine", () => ({
  startOfTodayIst: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },
}));

import { isNearDailyLimit, isOverDailyLimit, qrHeadroom } from "@/lib/qr/rotation";

describe("qrHeadroom", () => {
  it("returns remaining rupees on a capped QR", () => {
    const h = qrHeadroom({ dailyLimit: dec(20_000), dailyLimitCount: null }, { amount: 14_534, count: 3 });
    expect(h.dailyLimit).toBe(20_000);
    expect(h.collected).toBe(14_534);
    expect(h.remainingAmount).toBe(5_466);
    expect(h.remainingCount).toBeNull();
  });

  it("floors remaining at zero when the QR is already over its cap", () => {
    const h = qrHeadroom({ dailyLimit: dec(1_100), dailyLimitCount: 10 }, { amount: 1_500, count: 12 });
    expect(h.remainingAmount).toBe(0);
    expect(h.remainingCount).toBe(0);
  });

  it("treats null caps as unlimited", () => {
    const h = qrHeadroom({ dailyLimit: null, dailyLimitCount: null }, { amount: 50_000, count: 9 });
    expect(h.remainingAmount).toBeNull();
    expect(h.remainingCount).toBeNull();
    expect(isOverDailyLimit({ dailyLimit: null, dailyLimitCount: null }, { amount: 50_000, count: 9 })).toBe(false);
  });
});

describe("isNearDailyLimit", () => {
  it("flags a QR once 80% of the rupee cap is used", () => {
    expect(isNearDailyLimit({ dailyLimit: dec(20_000), dailyLimitCount: null }, { amount: 16_000, count: 1 })).toBe(true);
    expect(isNearDailyLimit({ dailyLimit: dec(20_000), dailyLimitCount: null }, { amount: 10_000, count: 1 })).toBe(false);
  });
});
