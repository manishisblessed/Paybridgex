/**
 * READ-ONLY: why does the engine fail to price specific captures?
 * For each ref, prints the mirror card dimensions and the result of the two
 * pricing legs the branded path uses: resolveBrandMdr (merchant MDR) and
 * getEffectiveMdr (revenue basis / retailer scheme), plus the MDR floor check.
 *
 * Run: $env:POS_TID="43136393"; npx tsx scripts/diagnose-pos-pricing.ts
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

const TID = (process.env.POS_TID ?? "43136393").trim();
const inr = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { resolveBrandMdr } = await import("../src/lib/brand/mdr");
  const { getEffectiveMdr } = await import("../src/lib/mdr/resolver");
  const { isAboveMdrFloor } = await import("../src/lib/mdr/floor");

  const machine = await prisma.posMachine.findFirst({
    where: { tid: TID },
    select: { id: true, brandId: true, company: true, provider: true, assignedUserId: true,
      assignedUser: { select: { name: true, schemeId: true } } },
  });
  if (!machine) { console.log("no machine"); await prisma.$disconnect(); return; }
  console.log(`machine brand=${machine.brandId} company=${machine.company} provider=${machine.provider} scheme=${machine.assignedUser?.schemeId}`);

  // Compare: recently-settled refs (worked) vs unsettled ones (failing).
  const rows = await prisma.posTransactionMirror.findMany({
    where: { terminalId: TID, status: "CAPTURED" },
    orderBy: { txnTime: "desc" },
    select: { transactionRef: true, amount: true, txnTime: true, paymentMode: true, cardType: true, cardBrand: true, cardClassification: true },
    take: 20,
  });

  for (const t of rows) {
    const gross = Number(t.amount);
    const dims = { paymentMode: t.paymentMode ?? "CARD", cardType: t.cardType, brandType: t.cardBrand, classification: t.cardClassification };
    console.log(`\n${t.transactionRef}  ${inr(gross)}  pm=${t.paymentMode ?? "—"} cardType=${t.cardType ?? "—"} brand=${t.cardBrand ?? "—"} class=${t.cardClassification ?? "—"}`);

    let brandMdr: unknown = null;
    try {
      brandMdr = await resolveBrandMdr({
        brandId: machine.brandId!, amount: gross, provider: machine.provider,
        paymentMode: t.paymentMode ?? "CARD", cardType: t.cardType ?? null, brandType: t.cardBrand ?? null,
        classification: t.cardClassification ?? null, settlementType: "T1",
      });
    } catch (e) { brandMdr = `ERR:${(e as Error).message}`; }
    console.log(`  resolveBrandMdr → ${brandMdr ? JSON.stringify(brandMdr) : "NULL (no brand rate slab matched)"}`);

    let rev: { source?: string; mdr?: unknown } | null = null;
    try {
      rev = await getEffectiveMdr(machine.assignedUserId!, "POS" as never, gross, { ...dims, settlementType: "T1", company: machine.company } as never);
    } catch (e) { console.log(`  getEffectiveMdr → ERR:${(e as Error).message}`); }
    if (rev) console.log(`  getEffectiveMdr → source=${rev.source} mdr=${rev.mdr}`);

    if (brandMdr && typeof brandMdr === "object" && "mdr" in (brandMdr as Record<string, unknown>)) {
      const floor = await isAboveMdrFloor("POS", t.paymentMode ?? "CARD", (brandMdr as { mdr: never }).mdr, gross, "T1");
      console.log(`  isAboveMdrFloor → ${floor}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
