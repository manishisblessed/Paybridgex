import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fakeDb";

/**
 * Static-QR claim tests — the invariants under test:
 *   1. One UPI payment (UTR) settles AT MOST ONCE, platform-wide.
 *   2. One screenshot backs at most one claim.
 *   3. Money moves only on admin approval with portal attestation, exactly
 *      once, and large amounts need a second, different admin.
 */

const holder = vi.hoisted(() => ({ db: undefined as unknown as FakeDb }));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    { get: (_t, prop) => (holder.db as unknown as Record<PropertyKey, unknown>)[prop] }
  ),
}));

// Stub the scheme-MDR pricing so these tests exercise the settlement STATE
// MACHINE + double-credit guarantee, not the MDR resolver (covered elsewhere).
// Instant (T0) = 3% MDR; T+1 = 2% MDR — so we can assert the net differs.
vi.mock("@/lib/settlement/engine", async () => {
  const { Prisma } = await import("@prisma/client");
  return {
    SETTLED_VIA: { INSTANT_AUTO: "INSTANT_AUTO", INSTANT_BUTTON: "INSTANT_BUTTON", T1_CRON: "T1_CRON" },
    startOfTodayIst: () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    },
    priceSchemeSettlement: async ({
      grossAmount,
      settlementType,
    }: {
      grossAmount: number | string;
      settlementType: "T0" | "T1";
    }) => {
      const gross = new Prisma.Decimal(String(grossAmount));
      const rate = new Prisma.Decimal(settlementType === "T0" ? "0.03" : "0.02");
      const mdrAmount = gross.mul(rate).toDecimalPlaces(2);
      const netAmount = gross.sub(mdrAmount).toDecimalPlaces(2);
      return { mdrAmount, netAmount, schemeId: "scheme1", slabId: "slab1", vendorAmount: null, vendorRateId: null };
    },
  };
});

import {
  approveQrClaim,
  clawbackQrClaim,
  instantSettleQrClaims,
  runQrT1SettlementSweep,
  precheckQrClaim,
  rejectQrClaim,
  screenshotSha256,
  submitQrClaim,
  QrClaimError,
  dailyClaimCountLimit,
} from "@/lib/qr/claims";

let utrSeq = 100_000_000_000;
const nextUtr = () => String(utrSeq++);
const hashOf = (s: string) => screenshotSha256(Buffer.from(s));

function validClaim(overrides: Partial<Parameters<typeof submitQrClaim>[0]> = {}) {
  // Always derive a unique token for the screenshot hash/public id even when the
  // claim itself carries no UTR (card-only), so each fixture stays distinct.
  const token = overrides.utr ?? nextUtr();
  return {
    userId: "retailer1",
    qrId: "qr1",
    amount: 500,
    cardLast4: "1234",
    utr: token,
    paidAt: new Date(Date.now() - 60 * 60 * 1000), // an hour ago
    screenshotHash: overrides.screenshotHash ?? hashOf(`shot-${token}`),
    screenshotPublicId: `cld/${token}`,
    screenshotFormat: "jpg",
    ...overrides,
  };
}

beforeEach(() => {
  holder.db = new FakeDb();
  holder.db.addUser("retailer1", 1000);
  holder.db.addUser("retailer2", 0);
  holder.db.addStaticQr("qr1");
});

describe("submitQrClaim — validation", () => {
  it("creates a PENDING claim and moves no money", async () => {
    const claim = await submitQrClaim(validClaim());
    expect(claim.status).toBe("PENDING");
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
    expect(holder.db.auditLogs.some((l) => l.action === "qr_claim.submitted")).toBe(true);
  });

  it("rejects malformed UTRs", async () => {
    await expect(submitQrClaim(validClaim({ utr: "12345" }))).rejects.toThrow(QrClaimError);
    await expect(submitQrClaim(validClaim({ utr: "ABCD12345678" }))).rejects.toThrow(/12-digit/);
  });

  it("requires the RuPay card last-4", async () => {
    await expect(submitQrClaim(validClaim({ cardLast4: "" }))).rejects.toThrow(/last 4/);
    await expect(submitQrClaim(validClaim({ cardLast4: "12" }))).rejects.toThrow(/last 4/);
  });

  it("accepts a card-only claim with no UTR and no paid-on time", async () => {
    const claim = await submitQrClaim(validClaim({ utr: null, paidAt: null }));
    expect(claim.status).toBe("PENDING");
    expect(claim.utr).toBeNull();
    expect(claim.paidAt).toBeNull();
    expect(claim.cardLast4).toBe("1234");
  });

  it("normalizes spaces/hyphens in the UTR", async () => {
    const claim = await submitQrClaim(validClaim({ utr: "1234 5678-9012" }));
    expect(claim.utr).toBe("123456789012");
  });

  it("rejects future and stale paidAt", async () => {
    await expect(
      submitQrClaim(validClaim({ paidAt: new Date(Date.now() + 60 * 60 * 1000) }))
    ).rejects.toThrow(/future/);
    await expect(
      submitQrClaim(validClaim({ paidAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }))
    ).rejects.toThrow(/older/);
  });

  it("rejects claims on an unknown QR", async () => {
    await expect(submitQrClaim(validClaim({ qrId: "nope" }))).rejects.toThrow(/not found/);
  });

  it("disabled QR: accepts payments dated before the switch, refuses after", async () => {
    const disabledAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    holder.db.addStaticQr("oldqr", { active: false, disabledAt });

    const before = await submitQrClaim(
      validClaim({ qrId: "oldqr", paidAt: new Date(disabledAt.getTime() - 60 * 60 * 1000) })
    );
    expect(before.status).toBe("PENDING");

    await expect(
      submitQrClaim(validClaim({ qrId: "oldqr", paidAt: new Date(disabledAt.getTime() + 60 * 60 * 1000) }))
    ).rejects.toThrow(/disabled/);
  });
});

describe("submitQrClaim — dedupe (the anti-double-settlement core)", () => {
  it("refuses a UTR that was already claimed — even by another user", async () => {
    const utr = nextUtr();
    await submitQrClaim(validClaim({ utr }));
    await expect(
      submitQrClaim(validClaim({ utr, userId: "retailer2", screenshotHash: hashOf("other-shot") }))
    ).rejects.toThrow(/already been claimed/);
  });

  it("refuses a re-used screenshot even with a fresh UTR", async () => {
    const shot = hashOf("same-image-bytes");
    await submitQrClaim(validClaim({ screenshotHash: shot }));
    await expect(submitQrClaim(validClaim({ screenshotHash: shot }))).rejects.toThrow(/screenshot/);
  });

  it("a rejected claim still burns its UTR (no resubmit-after-reject loophole)", async () => {
    const utr = nextUtr();
    const claim = await submitQrClaim(validClaim({ utr }));
    await rejectQrClaim({ claimId: claim.id as string, adminId: "admin1", note: "fake screenshot" });
    await expect(
      submitQrClaim(validClaim({ utr, screenshotHash: hashOf("retry-shot") }))
    ).rejects.toThrow(/already been claimed/);
  });

  it("enforces the daily claim-count velocity cap", async () => {
    for (let i = 0; i < dailyClaimCountLimit(); i++) {
      await submitQrClaim(validClaim());
    }
    await expect(submitQrClaim(validClaim())).rejects.toThrow(/Daily claim limit/);
  });

  it("enforces the daily amount velocity cap", async () => {
    await expect(precheckQrClaim(validClaim({ amount: 99_000 }))).resolves.toBeTruthy();
    await submitQrClaim(validClaim({ amount: 99_000 }));
    await submitQrClaim(validClaim({ amount: 99_000 }));
    await expect(submitQrClaim(validClaim({ amount: 50_000 }))).rejects.toThrow(/amount limit/);
  });
});

describe("approveQrClaim — approval makes a claim SETTLEABLE (no money moves)", () => {
  it("refuses approval without the portal attestation", async () => {
    const claim = await submitQrClaim(validClaim());
    await expect(
      approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: false })
    ).rejects.toThrow(/provider portal/);
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
  });

  it("moves the claim to SETTLEABLE and credits nothing", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 750 }));
    const r = await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });
    expect(r.status).toBe("SETTLEABLE");
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
    expect(holder.db.walletTxns).toHaveLength(0);

    // A second approve (racing admin / retry) is refused — it's no longer PENDING.
    await expect(
      approveQrClaim({ claimId: claim.id as string, adminId: "admin2", portalVerified: true })
    ).rejects.toThrow(/already SETTLEABLE/);
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
  });

  it("stages large amounts for a second approval and moves no money yet", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 50_000 }));
    const r = await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });
    expect(r.status).toBe("AWAITING_SECOND_APPROVAL");
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
    expect(holder.db.walletTxns).toHaveLength(0);
  });

  it("the same admin cannot give the second approval", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 50_000 }));
    await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });
    await expect(
      approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true })
    ).rejects.toThrow(/different admin/);
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
  });

  it("a different admin's second approval makes it SETTLEABLE (still no credit)", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 50_000 }));
    await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });
    const r = await approveQrClaim({ claimId: claim.id as string, adminId: "admin2", portalVerified: true });
    expect(r.status).toBe("SETTLEABLE");
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
    expect(holder.db.walletTxns).toHaveLength(0);
  });
});

describe("instantSettleQrClaims — retailer button (T0 scheme MDR)", () => {
  it("credits net (gross − T0 MDR) exactly once, never twice", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 750 }));
    await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });

    const r = await instantSettleQrClaims("retailer1", [claim.id as string]);
    expect(r.settled).toBe(1);
    // 750 − 3% = 727.50
    expect(holder.db.balanceOf("retailer1")).toBe("1727.50");
    expect(holder.db.walletTxns).toHaveLength(1);

    // Re-clicking the button must not double-credit (claim is now SETTLED).
    const again = await instantSettleQrClaims("retailer1", [claim.id as string]);
    expect(again.settled).toBe(0);
    expect(again.skipped).toBe(1);
    expect(holder.db.balanceOf("retailer1")).toBe("1727.50");
    expect(holder.db.walletTxns).toHaveLength(1);
  });

  it("only settles claims owned by the caller", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 500 }));
    await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });

    const r = await instantSettleQrClaims("retailer2", [claim.id as string]);
    expect(r.settled).toBe(0);
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
  });
});

describe("runQrT1SettlementSweep — next-day auto settle (T1 scheme MDR)", () => {
  it("settles yesterday's SETTLEABLE claims and skips today's", async () => {
    // Approved yesterday → due for the T+1 sweep.
    const old = await submitQrClaim(validClaim({ amount: 1000 }));
    await approveQrClaim({ claimId: old.id as string, adminId: "admin1", portalVerified: true });
    const oldRow = holder.db.qrClaims.find((c) => c.id === old.id)!;
    oldRow.settleableAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Approved just now → not yet due (settleableAt >= start of today).
    const fresh = await submitQrClaim(validClaim({ amount: 500 }));
    await approveQrClaim({ claimId: fresh.id as string, adminId: "admin1", portalVerified: true });

    const r = await runQrT1SettlementSweep();
    expect(r.settled).toBe(1);
    // 1000 − 2% = 980
    expect(holder.db.balanceOf("retailer1")).toBe("1980.00");
    expect((holder.db.qrClaims.find((c) => c.id === fresh.id) as { status: string }).status).toBe("SETTLEABLE");
  });

  it("does not double-settle a claim already settled instantly", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 1000 }));
    await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });
    // Instant-settle it, then backdate so the sweep would otherwise pick it up.
    await instantSettleQrClaims("retailer1", [claim.id as string]);
    const row = holder.db.qrClaims.find((c) => c.id === claim.id)!;
    row.settleableAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(holder.db.balanceOf("retailer1")).toBe("1970.00"); // 1000 − 3%

    const r = await runQrT1SettlementSweep();
    expect(r.settled).toBe(0);
    expect(holder.db.balanceOf("retailer1")).toBe("1970.00");
    expect(holder.db.walletTxns).toHaveLength(1);
  });
});

describe("rejectQrClaim / clawbackQrClaim", () => {
  it("rejects with a mandatory note and never credits", async () => {
    const claim = await submitQrClaim(validClaim());
    await expect(
      rejectQrClaim({ claimId: claim.id as string, adminId: "admin1", note: "  " })
    ).rejects.toThrow(/note is required/);
    const r = await rejectQrClaim({ claimId: claim.id as string, adminId: "admin1", note: "UTR not in portal" });
    expect(r.status).toBe("REJECTED");
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");

    // Terminal: cannot be approved afterwards.
    await expect(
      approveQrClaim({ claimId: claim.id as string, adminId: "admin2", portalVerified: true })
    ).rejects.toThrow(/already REJECTED/);
  });

  it("claws back a SETTLED claim's NET exactly once", async () => {
    const claim = await submitQrClaim(validClaim({ amount: 400 }));
    await approveQrClaim({ claimId: claim.id as string, adminId: "admin1", portalVerified: true });
    await instantSettleQrClaims("retailer1", [claim.id as string]);
    // 400 − 3% = 388 credited → balance 1388
    expect(holder.db.balanceOf("retailer1")).toBe("1388.00");

    const r = await clawbackQrClaim({ claimId: claim.id as string, adminId: "admin1", note: "never settled by provider" });
    expect(r.status).toBe("CLAWED_BACK");
    // debits the NET (388) back → balance 1000
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");

    await expect(
      clawbackQrClaim({ claimId: claim.id as string, adminId: "admin1", note: "again" })
    ).rejects.toThrow(/Only settled/);
    expect(holder.db.balanceOf("retailer1")).toBe("1000.00");
  });
});
