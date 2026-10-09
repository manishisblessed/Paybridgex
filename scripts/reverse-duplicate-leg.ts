/**
 * CORRECTIVE one-off: reverse the PHANTOM leg(s) of a double-charged provider
 * order — the RT0107 / P2F1791454006YSNK9 class of incident, where a rapid
 * same-card re-tap collapsed to ONE upstream order but settled TWO internal
 * Transaction rows (both SUCCESS), debiting the retailer twice.
 *
 * It uses the sanctioned, idempotent reversal desk (src/lib/reversal/service.ts),
 * which posts the REVERSAL credit (amount + fee) back to the retailer, flips the
 * row to REFUNDED, and links an audited Reversal record. Re-running is a safe
 * no-op (the desk refuses a duplicate COMPLETED reversal of the same entity).
 *
 * SAFE BY DEFAULT: dry-run unless CONFIRM=1. Dry-run moves no money — it prints
 * the provider's authoritative status/amount and exactly which leg(s) it WOULD
 * reverse and why.
 *
 * How it decides which leg is the phantom:
 *   • If the provider confirms the order SUCCESS for amount A → the leg whose
 *     amount == A is the REAL charge (kept); every other SUCCESS leg on the
 *     same order is a phantom and is reversed.
 *   • If the provider says the order did NOT succeed (card not credited) → ALL
 *     SUCCESS legs on the order are phantom and are reversed (full refund).
 *   • If it can't tell (no leg matches A, or several do) → it ABORTS and asks
 *     for an explicit PROVIDER_AMOUNT / KEEP_REF, so money never moves on a guess.
 *
 * Usage (provider poll needs the IP-whitelisted EC2 box):
 *   # dry run — provider-verified plan, no money moves:
 *   ORDER=P2F1791454006YSNK9 ./node_modules/.bin/tsx scripts/reverse-duplicate-leg.ts
 *   # execute:
 *   ORDER=P2F1791454006YSNK9 CONFIRM=1 ./node_modules/.bin/tsx scripts/reverse-duplicate-leg.ts
 *
 * If you've confirmed the real settled amount from the SameDay dashboard and
 * can't poll (e.g. off-EC2), skip the poll with an explicit override:
 *   ORDER=P2F1791454006YSNK9 PROVIDER_STATUS=SUCCESS PROVIDER_AMOUNT=48000 CONFIRM=1 ...
 *   ORDER=P2F1791454006YSNK9 PROVIDER_STATUS=FAILED  CONFIRM=1 ...   # card not credited → reverse all
 *   ORDER=P2F1791454006YSNK9 KEEP_REF=TXNAUWAHSGJZM   CONFIRM=1 ...   # keep this leg, reverse the rest
 *
 * Optional:
 *   ACTOR=<userId>   admin recorded on the Reversal/audit (defaults to a MASTER_ADMIN)
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { getPartner } from "../src/lib/partners";
import { deriveTxnRefs } from "../src/lib/recon/refs";
import { createReversal, reversalInputFromTransaction } from "../src/lib/reversal/service";

const ORDER = (process.env.ORDER ?? process.env.REF ?? "").trim();
const CONFIRM = process.env.CONFIRM === "1";
const ACTOR = (process.env.ACTOR ?? "").trim();
const KEEP_REF = (process.env.KEEP_REF ?? "").trim();
const PROVIDER_STATUS = (process.env.PROVIDER_STATUS ?? "").trim().toUpperCase();
const PROVIDER_AMOUNT = process.env.PROVIDER_AMOUNT ? Number(process.env.PROVIDER_AMOUNT) : null;

const inr = (n: unknown) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");

async function main() {
  if (!ORDER) {
    console.error("Set ORDER=<partnerTxnId>  (or REF=<TXN…/partnerTxnId>)");
    process.exit(1);
  }

  // Resolve the order group: every row sharing this partnerTxnId (accept a refId too).
  const seed = await prisma.transaction.findFirst({
    where: { OR: [{ partnerTxnId: ORDER }, { refId: ORDER }] },
    select: { partnerTxnId: true },
  });
  const partnerTxnId = seed?.partnerTxnId ?? ORDER;

  const rows = await prisma.transaction.findMany({
    where: { partnerTxnId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, refId: true, userId: true, service: true, partner: true, status: true,
      amount: true, fee: true, customer: true, request: true, response: true,
      createdAt: true, refundedAt: true,
      user: { select: { name: true, userCode: true, walletBalance: true } },
    },
  });

  if (rows.length === 0) { console.error(`No transactions found for order ${partnerTxnId}`); process.exit(1); }

  console.log(`\n=== Order ${partnerTxnId} — ${rows.length} internal row(s) ===`);
  for (const r of rows) {
    console.log(
      `  ${iso(r.createdAt)} ${r.refId} ${r.status} amt=${inr(r.amount)} fee=${inr(r.fee)} ` +
        `owner=${r.user?.name} (${r.user?.userCode}) refundedAt=${iso(r.refundedAt)}`
    );
  }

  const successRows = rows.filter((r) => r.status === "SUCCESS");
  if (successRows.length < 2) {
    console.log(`\nNothing to do: ${successRows.length} SUCCESS row(s) on this order (double-charge needs ≥2). No reversal.`);
    await prisma.$disconnect();
    return;
  }

  // ── Authoritative provider status + amount ────────────────────────────────
  let provStatus = PROVIDER_STATUS;
  let provAmount = PROVIDER_AMOUNT;
  if (!provStatus) {
    console.log(`\n--- provider bill/status (read-only) ---`);
    const bbps = getPartner("bbps");
    const refs = Array.from(
      new Set(successRows.flatMap((r) => deriveTxnRefs({ partnerTxnId, request: r.request, response: r.response })))
    );
    if (bbps.status) {
      for (const ref of refs) {
        let r = await bbps.status({ orderId: ref });
        if (!r.ok) r = await bbps.status({ requestId: ref });
        if (!r.ok) r = await bbps.status({ billFetchRef: ref });
        if (r.ok) {
          provStatus = r.data.status;
          const raw = (r.raw ?? {}) as Record<string, unknown>;
          provAmount = typeof raw.amount === "number" ? raw.amount : provAmount;
          console.log(`  ref=${ref} -> status=${r.data.status} amount=${raw.amount ?? "-"} opRef=${r.data.operatorRef ?? "-"}`);
          break;
        }
        console.log(`  ref=${ref} -> NOT RESOLVED (${r.code})`);
      }
    }
    if (!provStatus) {
      console.error(
        `\n✗ Could not reach the provider (IP not whitelisted off-EC2, or no ref resolved).\n` +
          `  Run on the EC2 box, OR confirm from the SameDay dashboard and pass\n` +
          `  PROVIDER_STATUS=SUCCESS PROVIDER_AMOUNT=<amt>  (or KEEP_REF=<TXN…>).`
      );
      process.exit(2);
    }
  }

  // ── Decide which leg(s) to reverse ────────────────────────────────────────
  let keepRefId: string | null = null;
  let toReverse: typeof successRows = [];

  if (KEEP_REF) {
    const keep = successRows.find((r) => r.refId === KEEP_REF || r.id === KEEP_REF);
    if (!keep) { console.error(`✗ KEEP_REF=${KEEP_REF} is not a SUCCESS leg on this order.`); process.exit(2); }
    keepRefId = keep.refId;
    toReverse = successRows.filter((r) => r.refId !== keep.refId);
  } else if (provStatus === "SUCCESS") {
    if (provAmount == null) {
      console.error(`✗ Provider SUCCESS but no settled amount available — pass PROVIDER_AMOUNT=<amt> or KEEP_REF=<TXN…>.`);
      process.exit(2);
    }
    const matches = successRows.filter((r) => Number(r.amount) === Number(provAmount));
    if (matches.length !== 1) {
      console.error(
        `✗ Ambiguous: ${matches.length} SUCCESS leg(s) match provider amount ${inr(provAmount)} ` +
          `(need exactly 1 to keep). Pass KEEP_REF=<TXN…> explicitly.`
      );
      process.exit(2);
    }
    keepRefId = matches[0].refId;
    toReverse = successRows.filter((r) => r.refId !== keepRefId);
  } else {
    // Provider says the order did NOT succeed → card not credited → reverse ALL.
    toReverse = successRows;
  }

  console.log(`\n--- PLAN ---`);
  console.log(`provider status : ${provStatus}${provAmount != null ? ` amount=${inr(provAmount)}` : ""}`);
  console.log(`KEEP (real)     : ${keepRefId ?? "(none — card not credited, reverse all)"}`);
  for (const r of toReverse) {
    console.log(`REVERSE phantom : ${r.refId} → credit ${inr(Number(r.amount) + Number(r.fee))} back to ${r.user?.name} (${r.user?.userCode})`);
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — no money moved. Re-run with CONFIRM=1 to execute.\n`);
    await prisma.$disconnect();
    return;
  }

  // Resolve admin actor for the Reversal/audit trail.
  let actorId = ACTOR;
  if (!actorId) {
    const admin = await prisma.user.findFirst({ where: { role: "MASTER_ADMIN", deletedAt: null }, select: { id: true, email: true } });
    if (!admin) { console.error("No MASTER_ADMIN found — set ACTOR=<userId>."); process.exit(1); }
    actorId = admin.id;
    console.log(`\nactor: ${admin.email} (${admin.id})`);
  }

  console.log(`\nExecuting reversal(s) via the sanctioned reversal desk...`);
  for (const r of toReverse) {
    const input = await reversalInputFromTransaction(r.refId);
    if (!input) { console.error(`  ${r.refId}: could not build reversal input — skipped.`); continue; }
    try {
      const rev = await createReversal({
        actorId,
        kind: "TRANSACTION",
        reason: `Duplicate leg on provider order ${partnerTxnId} — one order charged twice (kept ${keepRefId ?? "none"}).`,
        ...input,
        direction: "CREDIT",
      });
      console.log(`  ✅ ${r.refId} reversed — Reversal ${rev.id}, credited ${inr(input.amount)} to the retailer.`);
    } catch (e) {
      console.error(`  ✗ ${r.refId}: ${(e as Error).message}`);
    }
  }

  console.log(`\nDone. Re-run the dry run to confirm the order now has exactly one non-refunded SUCCESS leg.\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
