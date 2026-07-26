import { prisma } from "@/lib/db";
import { debitWallet, creditWallet, LedgerError } from "@/lib/ledger";
import { dec, add, sub as subtract, toNumber, round, mul, gte } from "@/lib/money";
import { getSetting } from "@/lib/settings";

/**
 * POS rental billing — monthly wallet debit per active subscription.
 *
 * Idempotency: one invoice per (subscription, YYYY-MM period) enforced by the
 * unique PosRentalInvoice key + the ledger idempotency key `rent:<sub>:<period>`.
 * Insufficient balance produces a FAILED invoice that the next daily run
 * retries (the ledger key includes the period, so a later success in the same
 * period settles the same invoice exactly once).
 *
 * GST: when subscription.includeGst is true, 18% GST is added on top of the
 * base rent. The subscriber is debited rent + GST.
 *
 * Commission: each subscription stores a commission amount. On successful
 * billing the commission is credited to the assigner (createdById). This
 * cascades up the hierarchy — each tier's subscription has its own commission.
 */

const GST_RATE = dec("0.18"); // 18% GST
const TDS_RATE = dec("0.02"); // 2% TDS deducted from commission

/** IST billing period key (YYYY-MM). */
export function istPeriodKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .slice(0, 7);
}

/** IST day-of-month (1-31). */
function istDayOfMonth(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", day: "numeric" }).format(now)
  );
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar parts (year, 0-indexed month, day) for a UTC instant. */
function istYmd(now: Date): { y: number; m: number; d: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() };
}

/** UTC instant of IST-midnight on (year, month, day). Month over/underflow is normalized. */
function istMidnight(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day) - IST_OFFSET_MS);
}

/**
 * The volume-measurement window the rent waiver evaluates when billing runs at
 * `now`. It is the ~1-month cycle that just completed: from the previous
 * billing anchor up to the most recent one (≤ now). Business done by a machine
 * inside this window decides whether the invoice raised now is waived.
 *
 * `billingDay` is 1-28 (schema-enforced), so no short-month clamping is needed.
 */
export function posRentalBillingWindow(
  billingDay: number,
  now: Date,
  startedAt?: Date | null
): { windowStart: Date; windowEnd: Date } {
  const { m, y, d } = istYmd(now);
  // Most recent billing anchor at or before `now`.
  let ay = y;
  let am = m;
  if (d < billingDay) {
    am = m - 1; // billing day hasn't arrived yet this month → last month's anchor
  }
  const windowEnd = istMidnight(ay, am, billingDay);
  let windowStart = istMidnight(ay, am - 1, billingDay);
  // A subscription created mid-cycle only accrues from its start date.
  if (startedAt && startedAt.getTime() > windowStart.getTime()) windowStart = startedAt;
  return { windowStart, windowEnd };
}

/**
 * The current in-progress cycle for a subscription, used by the retailer
 * dashboard to show a countdown to the next billing day. `nextBilling` is the
 * upcoming billing date; the volume accrued in [cycleStart, now] is exactly the
 * window the billing run at `nextBilling` will evaluate for the waiver.
 */
export function posRentalCurrentCycle(
  billingDay: number,
  now: Date,
  startedAt?: Date | null
): { cycleStart: Date; nextBilling: Date } {
  const { m, y, d } = istYmd(now);
  let sy = y;
  let sm = m;
  if (d < billingDay) {
    sm = m - 1; // still before this month's billing day → current cycle began last month
  }
  let cycleStart = istMidnight(sy, sm, billingDay);
  const nextBilling = istMidnight(sy, sm + 1, billingDay);
  if (startedAt && startedAt.getTime() > cycleStart.getTime()) cycleStart = startedAt;
  return { cycleStart, nextBilling };
}

/**
 * Gross POS business a machine did within [start, end). "Business" is the full
 * transaction (swipe) amount across all payment modes — every captured
 * settlement entry counts regardless of settlement status. Legacy entries
 * without `capturedAt` fall back to their `createdAt`.
 */
export async function machineBusinessInWindow(
  machineId: string,
  start: Date,
  end: Date
): Promise<ReturnType<typeof dec>> {
  const agg = await prisma.posSettlementEntry.aggregate({
    where: {
      machineId,
      OR: [
        { capturedAt: { gte: start, lt: end } },
        { capturedAt: null, createdAt: { gte: start, lt: end } },
      ],
    },
    _sum: { grossAmount: true },
  });
  return dec(agg._sum.grossAmount ?? 0);
}

/** Compute the total debit for a subscription: base rent + optional GST. */
export function computeRentalAmounts(baseRent: number | string, includeGst: boolean) {
  const rent = dec(baseRent);
  const gst = includeGst ? round(mul(rent, GST_RATE)) : dec(0);
  const total = add(rent, gst);
  return { rent, gst, total };
}

export async function runPosRentalBilling(now = new Date()): Promise<{
  processed: number;
  billed: number;
  failed: number;
  skipped: number;
  waived: number;
}> {
  const cfg = await getSetting("pos.rental_billing");
  if (!cfg.enabled) return { processed: 0, billed: 0, failed: 0, skipped: 0, waived: 0 };

  const waiverCfg = await getSetting("pos.rental_waiver");

  const periodKey = istPeriodKey(now);
  const today = istDayOfMonth(now);

  const subs = await prisma.posSubscription.findMany({
    where: { status: "ACTIVE", billingDay: { lte: today } },
    include: { plan: true },
  });

  // Full active-subscription graph, indexed by (machine, subscriber). Upstream
  // subscriptions are cost anchors only — billing happens at the lowest active
  // tier. This map lets billing (a) skip upstream tiers that have a downstream
  // subscription and (b) cascade commission up EVERY tier of the chain when the
  // lowest tier is billed — not just the immediate parent.
  const allActiveSubs = await prisma.posSubscription.findMany({
    where: { status: "ACTIVE" },
    include: { plan: true },
  });
  const subByMachineUser = new Map<string, (typeof allActiveSubs)[number]>();
  const hasDownstream = new Set<string>();
  for (const s of allActiveSubs) {
    subByMachineUser.set(`${s.machineId}:${s.userId}`, s);
    if (s.createdById) hasDownstream.add(`${s.machineId}:${s.createdById}`);
  }

  let billed = 0;
  let failed = 0;
  let skipped = 0;
  let waived = 0;

  for (const sub of subs) {
    // Skip billing if the subscriber has created a downstream subscription
    // for this machine — they are billed indirectly via the commission spread.
    if (hasDownstream.has(`${sub.machineId}:${sub.userId}`)) {
      skipped++;
      continue;
    }

    const existing = await prisma.posRentalInvoice.findUnique({
      where: { subscriptionId_periodKey: { subscriptionId: sub.id, periodKey } },
    });
    if (existing && existing.status !== "FAILED") {
      skipped++;
      continue;
    }

    const effectiveRent = sub.monthlyRent ?? sub.plan.monthlyRent;
    const { rent, gst, total } = computeRentalAmounts(
      effectiveRent.toString(),
      sub.includeGst
    );

    if (!total.gt(0)) {
      skipped++;
      continue;
    }

    // Volume-based waiver: if this machine did at least the configured business
    // in its current billing cycle, waive the rent entirely — no wallet debit
    // and no commission cascade for this machine this cycle.
    if (waiverCfg.enabled && waiverCfg.thresholdPerMachine > 0) {
      const { windowStart, windowEnd } = posRentalBillingWindow(sub.billingDay, now, sub.startedAt);
      const business = await machineBusinessInWindow(sub.machineId, windowStart, windowEnd);
      if (gte(business, waiverCfg.thresholdPerMachine)) {
        const detail = `Auto-waived — ₹${toNumber(round(business))} POS business this cycle (target ₹${waiverCfg.thresholdPerMachine})`;
        if (existing) {
          await prisma.posRentalInvoice.update({
            where: { id: existing.id },
            data: {
              status: "WAIVED",
              amount: rent,
              gstAmount: gst,
              totalAmount: dec(0),
              commissionAmount: dec(0),
              walletTxnId: null,
              commissionTxnId: null,
              detail,
            },
          });
        } else {
          await prisma.posRentalInvoice.create({
            data: {
              subscriptionId: sub.id,
              periodKey,
              amount: rent,
              gstAmount: gst,
              totalAmount: dec(0),
              commissionAmount: dec(0),
              status: "WAIVED",
              detail,
            },
          });
        }
        waived++;
        continue;
      }
    }

    const commissionAmount = dec(sub.commission);

    try {
      // Debit subscriber (rent + GST)
      const txn = await debitWallet({
        userId: sub.userId,
        amount: total,
        reason: "RENTAL",
        refType: "PosSubscription",
        refId: sub.id,
        note: `POS rental ${sub.plan.name} · ${periodKey}${sub.includeGst ? " (incl. 18% GST)" : ""}`,
        idempotencyKey: `rent:${sub.id}:${periodKey}`,
      });

      // Cascade commission UP the entire chain on this machine. The lowest tier
      // (`sub`) is the only one debited; every tier above it earns its own
      // spread, credited to that tier's creator. Starting from the billed sub,
      // follow createdById → the parent's own subscription on the same machine,
      // crediting each tier. Each credit is idempotent per (subscription,
      // period) via its own key, and `visited` guards against any cycle.
      // When a subscription carries GST, 18% GST is added on top of that tier's
      // spread; 2% TDS is deducted from the base spread only (GST is a
      // pass-through, not income). net = spread + GST(spread) − TDS(spread).
      let commissionTxnId: string | null = null;
      {
        let node: (typeof allActiveSubs)[number] | undefined =
          subByMachineUser.get(`${sub.machineId}:${sub.userId}`);
        const visited = new Set<string>();
        while (node && node.createdById && !visited.has(node.id)) {
          visited.add(node.id);
          const spread = dec(node.commission);
          if (spread.gt(0)) {
            const commissionGst = node.includeGst ? round(mul(spread, GST_RATE)) : dec(0);
            const tdsAmount = round(mul(spread, TDS_RATE));
            const netCommission = add(subtract(spread, tdsAmount), commissionGst);
            if (netCommission.gt(0)) {
              try {
                const commTxn = await creditWallet({
                  userId: node.createdById,
                  amount: netCommission,
                  reason: "COMMISSION",
                  refType: "PosSubscription",
                  refId: node.id,
                  note: `POS rental commission · ${node.plan.name} · ${periodKey} (₹${toNumber(spread)} spread${node.includeGst ? ` + ₹${toNumber(commissionGst)} GST` : ""} − 2% TDS ₹${toNumber(tdsAmount)})`,
                  idempotencyKey: `rent-comm:${node.id}:${periodKey}`,
                });
                if (node.id === sub.id) commissionTxnId = commTxn.id;
              } catch (e) {
                console.error(`[pos-rental] commission credit failed for sub ${node.id}:`, e);
              }
            }
          }
          node = node.createdById
            ? subByMachineUser.get(`${sub.machineId}:${node.createdById}`)
            : undefined;
        }
      }

      if (existing) {
        await prisma.posRentalInvoice.update({
          where: { id: existing.id },
          data: {
            status: "PAID",
            amount: rent,
            gstAmount: gst,
            totalAmount: total,
            commissionAmount: commissionAmount,
            walletTxnId: txn.id,
            commissionTxnId,
            detail: null,
          },
        });
      } else {
        await prisma.posRentalInvoice.create({
          data: {
            subscriptionId: sub.id,
            periodKey,
            amount: rent,
            gstAmount: gst,
            totalAmount: total,
            commissionAmount: commissionAmount,
            status: "PAID",
            walletTxnId: txn.id,
            commissionTxnId,
          },
        });
      }
      billed++;
    } catch (e) {
      const detail =
        e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS"
          ? "insufficient wallet balance"
          : e instanceof Error
          ? e.message
          : "ledger error";
      if (existing) {
        await prisma.posRentalInvoice.update({ where: { id: existing.id }, data: { detail } });
      } else {
        await prisma.posRentalInvoice.create({
          data: {
            subscriptionId: sub.id,
            periodKey,
            amount: rent,
            gstAmount: gst,
            totalAmount: total,
            commissionAmount: commissionAmount,
            status: "FAILED",
            detail,
          },
        });
      }
      failed++;
    }
  }

  return { processed: subs.length, billed, failed, skipped, waived };
}

/** Rental revenue rollup for the admin billing view. */
export async function rentalBillingSummary(periodKey = istPeriodKey()) {
  const [byStatus, activeSubs, activeRent] = await Promise.all([
    prisma.posRentalInvoice.groupBy({
      by: ["status"],
      where: { periodKey },
      _count: true,
      _sum: { amount: true, gstAmount: true, totalAmount: true, commissionAmount: true },
    }),
    prisma.posSubscription.count({ where: { status: "ACTIVE" } }),
    // Total contracted base rent across ALL active subscriptions (not just the
    // current invoice page). Uses the per-sub override when set, else the plan
    // rate. GST is excluded — this is the recurring revenue figure.
    prisma.$queryRaw<{ sum: string | null }[]>`
      SELECT COALESCE(SUM(COALESCE(s."monthlyRent", p."monthlyRent")), 0)::text AS sum
      FROM "PosSubscription" s
      JOIN "PosRentalPlan" p ON p.id = s."planId"
      WHERE s.status = 'ACTIVE'
    `,
  ]);
  const get = (s: string) => byStatus.find((b) => b.status === s);
  return {
    periodKey,
    activeSubscriptions: activeSubs,
    activeMonthlyRent: toNumber(dec(activeRent[0]?.sum ?? 0)),
    paidCount: get("PAID")?._count ?? 0,
    paidAmount: toNumber(dec(get("PAID")?._sum.totalAmount ?? 0)),
    paidGst: toNumber(dec(get("PAID")?._sum.gstAmount ?? 0)),
    paidCommission: toNumber(dec(get("PAID")?._sum.commissionAmount ?? 0)),
    failedCount: get("FAILED")?._count ?? 0,
    failedAmount: toNumber(dec(get("FAILED")?._sum.totalAmount ?? 0)),
    waivedCount: get("WAIVED")?._count ?? 0,
  };
}
