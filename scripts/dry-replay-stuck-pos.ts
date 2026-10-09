/**
 * READ-ONLY dry replay of the POS settlement pricing path for a given IST day's
 * eligible-but-unsettled captures. Reproduces the READ portion of
 * handlePosCapture (holder → active → brand → settlement mode → priceMdr) and
 * reports, per row, the outcome OR the exact thrown error — so we can tell a
 * poison-pill (throw that aborts the whole sweep) from a clean NO_SCHEME.
 *
 * Creates NO settlement entries and credits NO wallet.
 *
 * Run: $env:POS_DAY="2026-10-09"; npx tsx scripts/dry-replay-stuck-pos.ts
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnvFile();

const DAY = (process.env.POS_DAY ?? "2026-10-09").trim();
const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function istDayWindow(day: string) {
  const [y, mo, d] = day.split("-").map(Number);
  const fromMs = Date.UTC(y, mo - 1, d) - 5.5 * 3600_000;
  return { from: new Date(fromMs), to: new Date(fromMs + 24 * 3600_000) };
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { resolvePosHolderAt } = await import("../src/lib/pos/holder");
  const { priceMdr } = await import("../src/lib/settlement/pos");
  const { getEffectiveMdr } = await import("../src/lib/mdr/resolver");
  const { isCardClassificationEnabled } = await import("../src/lib/settings");

  const { from, to } = istDayWindow(DAY);

  // Captured mirror rows with NO settlement entry, on an ACTIVE+schemed/branded,
  // assigned terminal (the "eligibleNoEntry" set).
  const mirror = await prisma.posTransactionMirror.findMany({
    where: { status: "CAPTURED", txnTime: { gte: from, lt: to }, source: { not: "MANUAL" } },
    orderBy: { txnTime: "asc" },
    select: { transactionRef: true, terminalId: true, amount: true, txnTime: true, paymentMode: true, cardType: true, cardBrand: true, cardClassification: true },
  });
  const haveEntry = new Set(
    (await prisma.posSettlementEntry.findMany({
      where: { transactionRef: { in: mirror.map((m) => m.transactionRef).filter(Boolean) as string[] } },
      select: { transactionRef: true },
    })).map((e) => e.transactionRef)
  );
  const classificationEnabled = await isCardClassificationEnabled();

  console.log(`\n=== DRY replay of eligible-but-unsettled captures for ${DAY} IST ===\n`);
  let throwCount = 0, noScheme = 0, priceable = 0, noHolder = 0, inactive = 0;
  let firstThrow: { ref: string; err: string } | null = null;

  for (const t of mirror) {
    if (!t.transactionRef || !t.terminalId) continue;
    if (haveEntry.has(t.transactionRef)) continue;
    const gross = Number(t.amount);
    if (!(gross > 0)) continue;

    try {
      const resolved = await resolvePosHolderAt(t.terminalId, t.txnTime);
      if (!resolved) { noHolder++; continue; } // not in our eligible scope anyway

      const user = await prisma.user.findUnique({ where: { id: resolved.userId }, select: { status: true, schemeId: true, name: true } });
      if (!user || user.status !== "ACTIVE") { inactive++; continue; }

      // Price exactly like the T+1 path.
      const priced = await priceMdr({
        userId: resolved.userId,
        brandId: resolved.brandId,
        provider: resolved.provider,
        paymentMode: t.paymentMode ?? "CARD",
        grossAmount: gross,
        settlementType: "T1",
        dims: {
          company: resolved.company,
          cardType: t.cardType,
          brandType: t.cardBrand,
          classification: classificationEnabled ? t.cardClassification : null,
        },
      });

      if (!priced) {
        noScheme++;
        // Show what the resolver returned so we know WHY it wasn't priceable.
        const mdr = await getEffectiveMdr(resolved.userId, "POS" as never, gross, {
          paymentMode: t.paymentMode ?? "CARD",
          settlementType: "T1",
          company: resolved.company,
          cardType: t.cardType,
          brandType: t.cardBrand,
          classification: classificationEnabled ? t.cardClassification : null,
        });
        console.log(`  NO_SCHEME  ${t.transactionRef.padEnd(30)} ${inr(gross).padStart(13)}  user=${user.name} scheme=${user.schemeId ?? "NONE"} resolver.source=${(mdr as { source?: string }).source}`);
      } else {
        priceable++;
        console.log(`  PRICEABLE  ${t.transactionRef.padEnd(30)} ${inr(gross).padStart(13)}  user=${user.name} mdr=${inr(Number(priced.mdrAmount))} → WOULD QUEUE T+1`);
      }
    } catch (e) {
      throwCount++;
      const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (!firstThrow) firstThrow = { ref: t.transactionRef, err };
      console.log(`  ✗ THROW    ${t.transactionRef.padEnd(30)} ${inr(gross).padStart(13)}  ${err}`);
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  PRICEABLE (would settle T+1): ${priceable}`);
  console.log(`  NO_SCHEME (needs slab)      : ${noScheme}`);
  console.log(`  THREW (poison pill)         : ${throwCount}`);
  console.log(`  no holder / inactive        : ${noHolder} / ${inactive}`);
  if (firstThrow) {
    console.log(`\n  FIRST THROW (this is what aborts the whole sweep, oldest-first):`);
    console.log(`    ref=${firstThrow.ref}`);
    console.log(`    err=${firstThrow.err}`);
  } else {
    console.log(`\n  No throws in the read path → the stall is a WORKER/JOB outage, not a poison-pill row.`);
    console.log(`  (${priceable} rows are cleanly PRICEABLE and will settle on the next healthy sweep.)`);
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("✗ replay harness failed:", e); process.exit(1); });
