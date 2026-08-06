/**
 * QR settlement readiness audit (READ-ONLY).
 *
 * For each ACTIVE retailer, checks everything the QR claim→approve→instant-settle
 * flow needs so the first test settles cleanly and books revenue + DT/MD/SD
 * commission:
 *   1. QR service enabled (global ServiceRoute qr_dynamic + user allowlist)
 *   2. Re-KYC not due (network-tier gate)
 *   3. Active scheme with an active QR MDR slab (and whether a T0/instant rate is set)
 *   4. Upline chain (DT/MD/SD) so commission has recipients
 * Also reports global prerequisites: QR route, an active StaticQr, revenue account.
 *
 * Run: npx tsx scripts/qr-readiness-audit.ts
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

const QR_KEY = "qr_dynamic";

async function main() {
  const { prisma } = await import("../src/lib/db");

  // ---- Global prerequisites ----
  const [qrRoute, activeQrs, revenueOwner] = await Promise.all([
    prisma.serviceRoute.findUnique({ where: { key: QR_KEY }, select: { enabled: true } }),
    prisma.staticQr.findMany({ where: { active: true }, select: { id: true, label: true, upiVpa: true } }),
    prisma.user.findFirst({ where: { role: "MASTER_ADMIN", deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);

  const qrGlobalOn = qrRoute ? qrRoute.enabled : true; // fail-open when unseeded
  console.log("\n=== QR readiness audit ===\n");
  console.log("GLOBAL:");
  console.log(`  QR service route (${QR_KEY}) enabled : ${qrGlobalOn}${qrRoute ? "" : " (no route row — fail-open default)"}`);
  console.log(`  Active StaticQr(s)                    : ${activeQrs.length}${activeQrs.length ? " → " + activeQrs.map((q) => q.label).join(", ") : "  ⚠ NONE"}`);
  console.log(`  Revenue account (oldest MASTER_ADMIN) : ${revenueOwner ? revenueOwner.name : "⚠ NONE"}`);

  // ---- Retailers ----
  const retailers = await prisma.user.findMany({
    where: { role: "RETAILER" },
    select: {
      id: true, name: true, userCode: true, status: true, schemeId: true,
      parentId: true, enabledServices: true,
      reKycRequired: true, reKycDueAt: true, reKycExempt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nRETAILERS (${retailers.length}):\n`);

  const now = new Date();
  for (const r of retailers) {
    const reasons: string[] = [];

    // 1. Active account
    if (r.status !== "ACTIVE") reasons.push(`status=${r.status}`);

    // 2. QR service allowlist (empty = all allowed)
    const qrAllowed = r.enabledServices.length === 0 || r.enabledServices.includes(QR_KEY);
    if (!qrGlobalOn) reasons.push("QR route disabled globally");
    if (!qrAllowed) reasons.push("QR not in user's enabledServices");

    // 3. Re-KYC gate (network tier)
    const reKycDue = !r.reKycExempt && (r.reKycRequired || (r.reKycDueAt != null && now >= r.reKycDueAt));
    if (reKycDue) reasons.push("re-KYC due");

    // 4. Scheme + QR slab
    let schemeName = "—";
    let qrSlabs = 0;
    let hasT0 = false;
    let bands: string[] = [];
    if (!r.schemeId) {
      reasons.push("no scheme assigned");
    } else {
      const scheme = await prisma.scheme.findFirst({ where: { id: r.schemeId, active: true }, select: { id: true, name: true } });
      if (!scheme) {
        reasons.push("assigned scheme inactive/missing");
      } else {
        schemeName = scheme.name;
        const slabs = await prisma.mdrSlab.findMany({
          where: { schemeId: scheme.id, serviceKind: "QR", active: true },
          select: { minAmount: true, maxAmount: true, mdrValue: true, mdrValueT0: true, mdrType: true,
                    commissionDistributor: true, commissionMaster: true, commissionSuperDistributor: true },
          orderBy: { minAmount: "asc" },
        });
        qrSlabs = slabs.length;
        hasT0 = slabs.some((s) => Number(s.mdrValueT0) > 0);
        bands = slabs.map((s) => `₹${Number(s.minAmount)}-${Number(s.maxAmount)}(${s.mdrType} mdr=${Number(s.mdrValue)}${Number(s.mdrValueT0) > 0 ? `/T0=${Number(s.mdrValueT0)}` : ""})`);
        if (qrSlabs === 0) reasons.push("scheme has NO active QR slab");
      }
    }

    // 5. Upline chain (RT → DT → MD → SD)
    const chain: string[] = [];
    let cur: string | null = r.parentId;
    for (let i = 0; i < 3 && cur; i++) {
      const p: { parentId: string | null; role: string; name: string } | null =
        await prisma.user.findUnique({ where: { id: cur }, select: { parentId: true, role: true, name: true } });
      if (!p) break;
      chain.push(`${p.role}:${p.name}`);
      cur = p.parentId;
    }
    if (chain.length === 0) reasons.push("no upline (no commission recipients)");

    const ready = reasons.length === 0;
    console.log(`  ${ready ? "✅ READY   " : "❌ NOT READY"}  ${r.name} [${r.userCode ?? "no-code"}]`);
    console.log(`      scheme: ${schemeName} | QR slabs: ${qrSlabs}${qrSlabs ? (hasT0 ? " (has T0/instant rate)" : " ⚠ no T0 rate → instant falls back to T1") : ""}`);
    if (bands.length) console.log(`      bands: ${bands.join(" ; ")}`);
    console.log(`      upline: ${chain.length ? chain.join(" → ") : "NONE"}`);
    if (!ready) console.log(`      blockers: ${reasons.join("; ")}`);
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error("\n✗ Audit failed:", e); process.exit(1); });
