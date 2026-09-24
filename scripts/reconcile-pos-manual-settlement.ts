/**
 * SAFE reconciliation for POS captures that were paid OUT-OF-BAND via a manual
 * admin wallet credit (an ADJUSTMENT pushed during an incident) but never went
 * through the settlement engine — so they still have NO PosSettlementEntry.
 *
 * THE PROBLEM THIS FIXES (double-pay landmine):
 *   The manual credit is an ADJUSTMENT WalletTxn. It does NOT carry the
 *   `pos-settle:<ref>` idempotency key, and the captures have no settlement
 *   entry. So the moment the ingest sweep runs it will create PENDING entries
 *   for these captures and the next T+1 run will credit them AGAIN.
 *
 * THE FIX (this script):
 *   For each targeted capture, create a PosSettlementEntry with status=SETTLED,
 *   priced at the exact MDR slab, linked to the pre-existing manual WalletTxn,
 *   settledVia=MANUAL_RECONCILE. It NEVER credits the wallet. Because the entry
 *   is SETTLED (sweeps only touch PENDING) and transactionRef is @unique
 *   (handlePosCapture returns DUPLICATE), no sweep can ever re-pay these.
 *
 * It does NOT touch the retailer's balance, does NOT reverse the manual credit
 * (the retailer is already spending it), and does NOT book commission/revenue
 * (that ADJUSTMENT bypassed revenue booking — surfaced as a follow-up below).
 *
 * TARGET SET (default): captures on this TID that are
 *   • CAPTURED (not MANUAL-slip), and
 *   • swiped within the current holder's window AND before the start of today IST
 *     (i.e. previous-day-and-earlier post-assignment captures — what a "yesterday"
 *     manual push covers), and
 *   • have NO settlement entry yet.
 * Override the window with RECONCILE_FROM / RECONCILE_TO (ISO) if needed.
 *
 * Run (PowerShell, repo root) — DRY RUN first, ALWAYS review the table:
 *   $env:POS_TID="43136393"; npx tsx scripts/reconcile-pos-manual-settlement.ts
 * Apply (writes SETTLED entries; NO wallet credit):
 *   $env:POS_TID="43136393"; $env:APPLY="1"; npx tsx scripts/reconcile-pos-manual-settlement.ts
 * Optional:
 *   $env:RECONCILE_WALLET_TXN_ID="..."  # force the WalletTxn to link as the payment
 *   $env:RECONCILE_FROM="2026-09-22T18:30:00Z"; $env:RECONCILE_TO="2026-09-23T18:30:00Z"
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(): void {
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnvFile();

const TID = (process.env.POS_TID ?? "43136393").trim();
const APPLY = process.env.APPLY === "1";
const FORCE_WTXN = (process.env.RECONCILE_WALLET_TXN_ID ?? "").trim() || null;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const inr = (n: number | string) =>
  "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Start of the current IST calendar day, as a UTC Date (matches the T+1 cron). */
function startOfTodayIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000);
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { priceMdr } = await import("../src/lib/settlement/pos");
  const { getEffectiveMdr } = await import("../src/lib/mdr/resolver");
  const { SETTLED_VIA } = await import("../src/lib/settlement/engine");
  const { toNumber, sub, round, dec } = await import("../src/lib/money");

  console.log(`\n=== POS manual-settlement reconciliation — TID ${TID} ===`);
  console.log(`Mode: ${APPLY ? "APPLY (will write SETTLED entries)" : "DRY RUN (no writes)"}\n`);

  const machine = await prisma.posMachine.findFirst({
    where: { tid: TID },
    select: {
      id: true, tid: true, brandId: true, company: true, provider: true,
      assignedUserId: true, assignedAt: true,
      assignedUser: { select: { id: true, name: true, userCode: true, status: true, schemeId: true } },
    },
  });
  if (!machine || !machine.assignedUserId || !machine.assignedUser) {
    console.log("No machine for that TID, or it is not currently assigned. Aborting.");
    await prisma.$disconnect();
    return;
  }

  const holder = machine.assignedUser;
  const holderId = machine.assignedUserId;

  // Holding-window start: prefer the ACTIVE assignment log; fall back to assignedAt.
  const activeLog = await prisma.posAssignmentLog.findFirst({
    where: { machineId: machine.id, action: "assign", toUserId: holderId, returnedDate: null },
    orderBy: { createdAt: "desc" },
    select: { assignedDate: true, createdAt: true },
  });
  const holderStart = activeLog?.assignedDate ?? activeLog?.createdAt ?? machine.assignedAt;
  if (!holderStart) {
    console.log("Could not resolve the holder's assignment start. Aborting.");
    await prisma.$disconnect();
    return;
  }

  const windowFrom = process.env.RECONCILE_FROM ? new Date(process.env.RECONCILE_FROM) : holderStart;
  const windowTo = process.env.RECONCILE_TO ? new Date(process.env.RECONCILE_TO) : startOfTodayIst();

  console.log(`Holder: ${holder.name} (${holder.userCode}) status=${holder.status} scheme=${holder.schemeId ?? "NONE"}`);
  console.log(`Machine: ${machine.id} brand=${machine.brandId ?? "—"} company=${machine.company ?? "—"} provider=${machine.provider ?? "—"}`);
  console.log(`Assignment start: ${iso(holderStart)}`);
  console.log(`Target capture window: [${iso(windowFrom)} , ${iso(windowTo)})  (post-assignment, before start-of-today IST)\n`);

  // Candidate captures: CAPTURED (not MANUAL), in-window, on this TID.
  const rows = await prisma.posTransactionMirror.findMany({
    where: {
      terminalId: TID,
      status: "CAPTURED",
      source: { not: "MANUAL" },
      txnTime: { gte: windowFrom, lt: windowTo },
    },
    orderBy: { txnTime: "asc" },
    select: {
      transactionRef: true, amount: true, txnTime: true,
      paymentMode: true, cardType: true, cardBrand: true, cardClassification: true,
    },
  });

  // Exclude any that already have a settlement entry (idempotent).
  const refs = rows.map((r) => r.transactionRef).filter(Boolean) as string[];
  const existing = refs.length
    ? await prisma.posSettlementEntry.findMany({
        where: { transactionRef: { in: refs } },
        select: { transactionRef: true, status: true },
      })
    : [];
  const existingRefs = new Set(existing.map((e) => e.transactionRef));
  const targets = rows.filter((r) => r.transactionRef && !existingRefs.has(r.transactionRef));

  console.log(`Captures in window: ${rows.length}  |  already have an entry: ${existingRefs.size}  |  to reconcile: ${targets.length}`);
  if (existingRefs.size) {
    for (const e of existing) console.log(`  (skip, already ${e.status}) ${e.transactionRef}`);
  }
  if (targets.length === 0) {
    console.log("\nNothing to reconcile. Exiting.");
    await prisma.$disconnect();
    return;
  }

  // Price each capture. Record the entry at the SAME basis the money was actually
  // paid on: try the brand rate card first (engine's primary path); if that does
  // not resolve (e.g. a provider/rate-card mismatch — the very failure that
  // forced the manual push), fall back to the retailer's SCHEME MDR, which is
  // what the manual credit was computed on. The total is cross-checked against
  // the actual manual WalletTxn below, so a wrong basis cannot silently apply.
  type Priced = {
    ref: string; gross: number; mdr: number; net: number; basis: "BRAND" | "SCHEME";
    txnTime: Date; paymentMode: string | null; cardType: string | null;
    brandType: string | null; classification: string | null;
    brandId: string | null; provider: string | null; mdrRateId: string | null;
  };
  const priced: Priced[] = [];
  const unpriceable: string[] = [];
  for (const t of targets) {
    const gross = Number(t.amount);
    const dims = {
      company: machine.company,
      cardType: t.cardType,
      brandType: t.cardBrand,
      classification: t.cardClassification,
    };
    const p = await priceMdr({
      userId: holderId,
      brandId: machine.brandId,
      provider: machine.provider,
      paymentMode: t.paymentMode ?? "CARD",
      grossAmount: gross,
      settlementType: "T1",
      dims,
    });
    if (p) {
      const mdr = toNumber(round(p.mdrAmount));
      priced.push({
        ref: t.transactionRef!, gross, mdr, net: toNumber(round(sub(dec(gross), p.mdrAmount))), basis: "BRAND",
        txnTime: t.txnTime, paymentMode: t.paymentMode, cardType: t.cardType, brandType: t.cardBrand,
        classification: t.cardClassification, brandId: p.brandId, provider: p.provider, mdrRateId: p.mdrRateId,
      });
      continue;
    }
    // Fallback: retailer scheme MDR (the basis the manual credit used).
    const scheme = await getEffectiveMdr(holderId, "POS" as never, gross, {
      paymentMode: t.paymentMode ?? "CARD",
      settlementType: "T1",
      company: machine.company,
      cardType: t.cardType,
      brandType: t.cardBrand,
      classification: t.cardClassification,
    } as never);
    if (!scheme || (scheme as { source?: string }).source === "NONE") {
      unpriceable.push(t.transactionRef!);
      continue;
    }
    const smdr = toNumber(round((scheme as { mdr: never }).mdr));
    priced.push({
      ref: t.transactionRef!, gross, mdr: smdr, net: toNumber(round(sub(dec(gross), dec(smdr)))), basis: "SCHEME",
      txnTime: t.txnTime, paymentMode: t.paymentMode, cardType: t.cardType, brandType: t.cardBrand,
      classification: t.cardClassification, brandId: null, provider: machine.provider,
      mdrRateId: (scheme as { slabId?: string }).slabId ?? null,
    });
  }

  console.log(`\nPriced captures (${priced.length}):`);
  let totGross = 0, totMdr = 0, totNet = 0;
  for (const p of priced) {
    totGross += p.gross; totMdr += p.mdr; totNet += p.net;
    console.log(
      `  ${p.ref.padEnd(30)} [${p.basis}] swipe=${iso(p.txnTime)} gross=${inr(p.gross).padStart(13)} ` +
        `mdr=${inr(p.mdr).padStart(11)} net=${inr(p.net).padStart(13)}`
    );
  }
  console.log(`  ${"TOTALS".padEnd(30)} ${" ".repeat(28)} gross=${inr(totGross).padStart(13)} mdr=${inr(totMdr).padStart(11)} net=${inr(totNet).padStart(13)}`);

  if (unpriceable.length) {
    console.log(`\n⚠ ${unpriceable.length} capture(s) could NOT be priced (no matching rate / scheme) — NOT reconciled:`);
    for (const r of unpriceable) console.log(`    ${r}`);
    console.log(`  Fix the brand rate / retailer scheme, then re-run.`);
  }

  // Find the manual credit WalletTxn to link (audit) + sanity-check the total.
  const sinceCredit = new Date(windowFrom.getTime() - 2 * 24 * 60 * 60 * 1000);
  const credits = await prisma.walletTxn.findMany({
    where: {
      userId: holderId,
      direction: "CREDIT",
      reason: { in: ["ADJUSTMENT", "POS_SETTLEMENT", "SETTLEMENT", "TOPUP"] },
      createdAt: { gte: sinceCredit },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, amount: true, reason: true, note: true, createdAt: true, idempotencyKey: true },
    take: 20,
  });
  console.log(`\nRecent manual/settlement CREDITs to ${holder.name} (to identify the out-of-band payment):`);
  for (const c of credits) {
    console.log(
      `  ${c.id}  ${inr(c.amount).padStart(14)}  ${c.reason.padEnd(14)} ` +
        `key=${c.idempotencyKey ?? "—"}  ${iso(c.createdAt)}  ${c.note ?? ""}`
    );
  }
  // Best match = a credit whose amount ≈ our net total (within ₹5).
  const autoMatch = credits.find((c) => Math.abs(toNumber(c.amount as never) - totNet) <= 5) ?? null;
  const linkTxn = FORCE_WTXN
    ? credits.find((c) => c.id === FORCE_WTXN) ?? { id: FORCE_WTXN, amount: 0, reason: "(forced)", createdAt: null }
    : autoMatch;

  if (linkTxn) {
    console.log(`\n→ Will LINK reconciled entries to WalletTxn ${linkTxn.id} (${inr(linkTxn.amount as never)}) as the settling payment.`);
    if (autoMatch && Math.abs(toNumber(autoMatch.amount as never) - totNet) > 0.01) {
      console.log(`  Note: manual credit ${inr(autoMatch.amount as never)} vs computed net ${inr(totNet)} differ by ${inr(Math.abs(toNumber(autoMatch.amount as never) - totNet))}.`);
    }
  } else {
    console.log(`\n⚠ No manual credit matched the computed net total (${inr(totNet)}) within ₹5.`);
    console.log(`  The reconciliation will still SETTLE-mark the entries (this blocks double-pay), but with walletTxnId=null.`);
    console.log(`  If you know the payment WalletTxn id, re-run with RECONCILE_WALLET_TXN_ID=<id> to link it.`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN complete. No writes made.`);
    console.log(`Review the table above. To apply: set APPLY=1 and re-run.`);
    console.log(`\nFOLLOW-UP (not done here): the manual ADJUSTMENT bypassed commission/revenue booking for`);
    console.log(`these ${priced.length} captures (company margin + upline commission were never booked).`);
    console.log(`That is a revenue-side reconciliation, separate from this double-pay fix.`);
    await prisma.$disconnect();
    return;
  }

  // ---- APPLY ----
  console.log(`\nAPPLYING: creating ${priced.length} SETTLED PosSettlementEntry rows (NO wallet credit)...`);
  const settledAt = (linkTxn && "createdAt" in linkTxn && linkTxn.createdAt) ? linkTxn.createdAt : new Date();
  let created = 0, skipped = 0;
  for (const p of priced) {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the tx — never create a second entry for a ref.
      const dup = await tx.posSettlementEntry.findUnique({ where: { transactionRef: p.ref }, select: { id: true } });
      if (dup) { skipped++; return; }
      await tx.posSettlementEntry.create({
        data: {
          transactionRef: p.ref,
          machineId: machine.id,
          userId: holderId,
          grossAmount: dec(p.gross),
          mdrAmount: dec(p.mdr),
          netAmount: dec(p.net),
          mode: "T1",
          status: "SETTLED",
          settledAt,
          settledVia: SETTLED_VIA.MANUAL_RECONCILE,
          walletTxnId: linkTxn ? linkTxn.id : null,
          paymentMode: p.paymentMode,
          cardType: p.cardType,
          brandType: p.brandType,
          classification: p.classification,
          company: machine.company,
          capturedAt: p.txnTime,
          brandId: p.brandId,
          provider: p.provider,
          mdrRateId: p.mdrRateId,
        },
      });
      created++;
    });
  }

  // Audit trail.
  await prisma.auditLog.create({
    data: {
      userId: holderId,
      action: "pos.settlement.manual_reconcile",
      entity: "PosSettlementEntry",
      meta: {
        tid: TID,
        machineId: machine.id,
        holderId,
        windowFrom: windowFrom.toISOString(),
        windowTo: windowTo.toISOString(),
        created,
        skipped,
        totalGross: totGross,
        totalMdr: totMdr,
        totalNet: totNet,
        linkedWalletTxnId: linkTxn ? linkTxn.id : null,
        refs: priced.map((p) => p.ref),
      } as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  console.log(`\n✓ Done. created=${created} skipped(existing)=${skipped}`);
  console.log(`  These captures are now SETTLED and can NEVER be re-paid by any sweep.`);
  console.log(`\nFOLLOW-UP (not done here): commission/revenue for these ${priced.length} captures was NOT booked`);
  console.log(`(the manual ADJUSTMENT bypassed it). Handle that revenue reconciliation separately.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Reconciliation failed:", e);
  process.exit(1);
});
