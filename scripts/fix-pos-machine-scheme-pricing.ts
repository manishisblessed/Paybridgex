/**
 * Restore SCHEME-SLAB pricing for a POS machine that was wrongly forced onto a
 * brand rate card it doesn't match (provider mismatch → every capture priced as
 * NO_SCHEME → nothing settles). Detaching the brand makes the engine price each
 * capture off the retailer's own scheme slab — how this machine settled before
 * the brand was (mis)attached.
 *
 * Also (optional) tops up a small rounding shortfall from an out-of-band manual
 * push so the retailer is paid the exact scheme net to the paisa.
 *
 * DRY RUN by default. Apply with APPLY=1. Idempotent (re-runs are safe).
 *   $env:POS_TID="43136393"; npx tsx scripts/fix-pos-machine-scheme-pricing.ts
 *   $env:POS_TID="43136393"; $env:APPLY="1"; npx tsx scripts/fix-pos-machine-scheme-pricing.ts
 * Rounding top-up (paise) — set to 0 to skip:
 *   $env:TOPUP_PAISE="70"
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
const APPLY = process.env.APPLY === "1";
const TOPUP_PAISE = Number(process.env.TOPUP_PAISE ?? "70"); // ₹0.70 default
const inr = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { creditWallet } = await import("../src/lib/ledger");

  console.log(`\n=== Restore scheme-slab pricing — TID ${TID} ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN (no writes)"}\n`);

  const machine = await prisma.posMachine.findFirst({
    where: { tid: TID },
    select: {
      id: true, tid: true, brandId: true, company: true, provider: true, assignedUserId: true,
      assignedUser: { select: { id: true, name: true, userCode: true, schemeId: true, walletBalance: true } },
    },
  });
  if (!machine) { console.log("No machine for that TID. Aborting."); await prisma.$disconnect(); return; }

  console.log(`Machine ${machine.id}  brand=${machine.brandId ?? "NULL"}  provider=${machine.provider ?? "—"}  company=${machine.company ?? "—"}`);
  console.log(`Holder: ${machine.assignedUser?.name ?? "—"} (${machine.assignedUser?.userCode ?? "—"}) scheme=${machine.assignedUser?.schemeId ?? "NONE"}`);
  console.log(`Current wallet balance: ${machine.assignedUser ? inr(machine.assignedUser.walletBalance as never) : "—"}\n`);

  // --- 1) Detach brand → scheme pricing ---
  if (machine.brandId) {
    console.log(`Plan: detach brand ${machine.brandId} → brandId=NULL (scheme-slab pricing).`);
    if (APPLY) {
      await prisma.posMachine.update({ where: { id: machine.id }, data: { brandId: null } });
      await prisma.auditLog.create({
        data: {
          userId: machine.assignedUserId ?? undefined,
          action: "pos.machine.brand_detach",
          entity: "PosMachine",
          entityId: machine.id,
          meta: { tid: TID, previousBrandId: machine.brandId, reason: "provider mismatch broke brand pricing; restore scheme-slab pricing" } as unknown as import("@prisma/client").Prisma.InputJsonValue,
        },
      });
      console.log(`  ✓ Brand detached.`);
    }
  } else {
    console.log(`Brand already NULL — machine already prices on scheme. Nothing to detach.`);
  }

  // --- 2) Rounding top-up ---
  if (TOPUP_PAISE > 0 && machine.assignedUserId) {
    const amount = TOPUP_PAISE / 100;
    const key = `pos-rounding-topup:${TID}:2026-09-23`;
    console.log(`\nPlan: top up ${inr(amount)} to ${machine.assignedUser?.name} (rounding shortfall from manual push; idempotencyKey=${key}).`);
    if (APPLY) {
      const txn = await creditWallet({
        userId: machine.assignedUserId,
        amount,
        reason: "ADJUSTMENT",
        refType: "PosSettlementEntry",
        refId: `SDPOS:${TID}:2026-09-23`,
        note: "Rounding top-up: 23-Sep POS settlement (manual push ₹3,84,067 vs scheme net ₹3,84,067.70)",
        idempotencyKey: key,
      });
      console.log(`  ✓ Credited. WalletTxn ${txn.id}  balanceAfter=${inr(txn.balanceAfter as never)}`);
    }
  } else if (TOPUP_PAISE <= 0) {
    console.log(`\nTop-up skipped (TOPUP_PAISE=0).`);
  }

  if (!APPLY) console.log(`\nDRY RUN complete. Re-run with APPLY=1 to apply.`);
  else console.log(`\n✓ Done.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("\n✗ Failed:", e); process.exit(1); });
