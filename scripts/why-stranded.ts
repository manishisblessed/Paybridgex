/**
 * READ-ONLY: For a TID, show every CAPTURED Sep-24 mirror txn that has NO
 * settlement entry, and explain WHY (holder gate, scheme/slab match, floor).
 *
 * Run on server: POS_TID=19968433 ./node_modules/.bin/tsx scripts/why-stranded.ts
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
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}
loadEnvFile();

const TID = (process.env.POS_TID ?? "19968433").trim();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { priceMdr } = await import("../src/lib/settlement/pos");
  const { getEffectiveMdr } = await import("../src/lib/mdr/resolver");
  const { resolvePosHolderForMachine } = await import("../src/lib/pos/holder");

  const machine = await prisma.posMachine.findFirst({
    where: { tid: TID },
    select: { id: true, brandId: true, company: true, provider: true, assignedUserId: true,
      assignedUser: { select: { name: true, schemeId: true } } },
  });
  if (!machine) { console.log("no machine"); await prisma.$disconnect(); return; }
  console.log(`TID ${TID}  holder=${machine.assignedUser?.name}  scheme=${machine.assignedUser?.schemeId ?? "NONE"}  company=${machine.company}  provider=${machine.provider}`);

  const rows = await prisma.posTransactionMirror.findMany({
    where: { terminalId: TID, source: { not: "MANUAL" } },
    orderBy: { txnTime: "asc" },
    select: { transactionRef: true, amount: true, txnTime: true, status: true, paymentMode: true, cardType: true, cardBrand: true, cardClassification: true },
  });
  const refs = rows.map((r) => r.transactionRef).filter(Boolean) as string[];
  const withEntry = new Set((await prisma.posSettlementEntry.findMany({ where: { transactionRef: { in: refs } }, select: { transactionRef: true } })).map((e) => e.transactionRef));

  const stranded = rows.filter((r) => r.status === "CAPTURED" && r.transactionRef && !withEntry.has(r.transactionRef));
  console.log(`\nCaptured with NO entry: ${stranded.length}\n`);

  for (const t of stranded) {
    const gross = Number(t.amount);
    const holder = await resolvePosHolderForMachine(machine.id, t.txnTime);
    const gate = holder?.userId === machine.assignedUserId ? "HOLDER-OK" : `HOLDER-MISMATCH(${holder?.userId ?? "none"})`;
    const mdr = await getEffectiveMdr(machine.assignedUserId!, "POS" as any, gross, {
      paymentMode: t.paymentMode ?? "CARD", settlementType: "T1",
      company: machine.company, cardType: t.cardType, brandType: t.cardBrand, classification: t.cardClassification,
    });
    const p = await priceMdr({
      userId: machine.assignedUserId!, brandId: machine.brandId, provider: machine.provider,
      paymentMode: t.paymentMode ?? "CARD", grossAmount: gross, settlementType: "T1",
      dims: { company: machine.company, cardType: t.cardType, brandType: t.cardBrand, classification: t.cardClassification },
    });
    console.log(`ref=${t.transactionRef}  swipe=${iso(t.txnTime)}  gross=${inr(gross)}`);
    console.log(`   dims: mode=${t.paymentMode} cardType=${t.cardType} brand=${t.cardBrand} class=${t.cardClassification}`);
    console.log(`   ${gate}  mdr.source=${mdr.source}  mdr.slabId=${mdr.slabId ?? "—"}  priceMdr=${p ? inr(p.mdrAmount) : "NULL(HOLD)"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
