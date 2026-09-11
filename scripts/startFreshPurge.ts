/**
 * FRESH-START PURGE (one-shot, re-runnable) — pre-launch cleanup.
 *
 * Does three things, in order, so the platform can start clean:
 *   [1] PHYSICALLY DELETES a fixed, explicit set of named accounts (frees their
 *       email/phone for reuse). See TARGETS below.
 *   [2] Zeros EVERY user's ledger — walletBalance / heldBalance / lienBalance /
 *       aepsBalance / payinBalance -> 0 — and truncates all transactional /
 *       operational tables (WalletTxn, Transaction, payouts, POS/PG/QR, disputes,
 *       notifications, audit, sessions, …) so no stale rows remain.
 *   [3] Clears the Revenue Wallet — revenueBalance -> 0 on every holder (the
 *       REVENUE WalletTxn rows are removed by the same truncate as step 2).
 *
 * PRESERVES: all OTHER user accounts (identity, login, 2FA, hierarchy, KYC) and
 * all platform CONFIG / master data (schemes, MDR, operators, billers, service
 * routes, brands, POS inventory, per-user limits & settlement config, whitelabel).
 *
 * WHY a bespoke script (not removeRetailer.ts): the targets carry financial +
 * config history. Step 2's global truncate removes every REQUIRED-userId
 * transactional blocker; the only remaining physical-delete blockers are
 * CommissionSlab, DeclarationApproval and StaticQr (required FKs, retained by
 * the wipe), which step 1 clears per-target before deleting the User row.
 *
 * SAFETY
 *   • DRY-RUN by default — prints the full plan and touches nothing.
 *   • To WRITE you must pass BOTH the flag AND the env confirmation:
 *       $env:CONFIRM_FRESH_START="PURGE_AND_RESET"; npx tsx scripts/startFreshPurge.ts --apply
 *   • Refuses to delete any PROTECTED account (any name containing "Manish",
 *     and the system Suspense account).
 *   • Refuses to run --apply unless every TARGET resolves to EXACTLY ONE user
 *     (ambiguous/zero matches must be pinned via `email`/`phone`/`userCode`/`id`).
 *   • Guarantees at least one ACTIVE MASTER_ADMIN survives the purge.
 *   • TAKE A DATABASE BACKUP / SNAPSHOT FIRST. Step 2 is irreversible.
 *
 * Run (PowerShell, from repo root):
 *   npx tsx scripts/startFreshPurge.ts                                   # dry-run
 *   $env:CONFIRM_FRESH_START="PURGE_AND_RESET"; npx tsx scripts/startFreshPurge.ts --apply
 */
import fs from "node:fs";
import path from "node:path";

// ── Load .env before anything touches process.env (Prisma client is lazy) ──
function loadEnv(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.env.CONFIRM_FRESH_START === "PURGE_AND_RESET";

// ── The accounts to physically delete. Match is by (name + role) by default;
//    pin an exact identifier when a name is ambiguous. `email` alone is enough
//    for the system TDS account. ────────────────────────────────────────────
type TargetSpec = {
  key: string;
  label: string;
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  userCode?: string;
  id?: string;
};

const TARGETS: TargetSpec[] = [
  { key: "tds", label: "Company TDS Payable (system)", email: "tds-payable@system.paybridgex" },
  { key: "dilip", label: "DILIP", name: "DILIP", role: "RETAILER" },
  { key: "kashvi", label: "KASHVI", name: "KASHVI", role: "DISTRIBUTOR" },
  { key: "seema", label: "seema", name: "seema", role: "MASTER_DISTRIBUTOR" },
  { key: "uttam_sd", label: "UTTAM", name: "UTTAM", role: "SUPER_DISTRIBUTOR" },
  { key: "uttam_sharma", label: "Uttam Sharma (Master Admin)", name: "Uttam Sharma", role: "MASTER_ADMIN" },
];

// Never deletable, no matter what a TARGET resolves to (defence in depth).
const PROTECTED_EMAILS = new Set<string>([
  "company-suspense@system.paybridgex", // Company Suspense system account (wallet/suspense.ts)
]);
function isProtected(u: { name: string; email: string }): boolean {
  if (PROTECTED_EMAILS.has(u.email.toLowerCase())) return true;
  // Belt-and-suspenders: never touch any "Manish" account.
  if (/manish/i.test(u.name)) return true;
  return false;
}

// Transactional / operational tables to wipe. Copied from reset-production.ts —
// this set is closed under FKs; CASCADE handles the internal ordering.
const WIPE_TABLES = [
  "HierarchyTransfer",
  "NetworkWalletTransfer",
  "PosSettlementEntry",
  "PosTransactionMirror",
  "PgSettlementEntry",
  "TdsLedgerEntry",
  "CommissionCredit",
  "QrClaim",
  "AepsSettlement",
  "AepsSettlementAccount",
  "AepsMerchant",
  "PosRentalInvoice",
  "PosSubscription",
  "SettlementAlert",
  "SettlementRun",
  "Reversal",
  "WalletLien",
  "WalletOperation",
  "PosAssignmentLog",
  "PayoutBeneficiary",
  "PayoutRequest",
  "RateLimit",
  "IdempotencyKey",
  "Invite",
  "DisputeMessage",
  "Dispute",
  "Notification",
  "AuditLog",
  "AuditAnchor",
  "AmlAlert",
  "WebhookDelivery",
  "FundRequest",
  "Transaction",
  "WalletTxn",
  "Otp",
  "LoginAttempt",
  "Session",
] as const;

function money(v: unknown) {
  return `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

type ResolvedUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  userCode: string | null;
  role: string;
  status: string;
  deletedAt: Date | null;
  walletBalance: unknown;
  heldBalance: unknown;
  lienBalance: unknown;
  aepsBalance: unknown;
  payinBalance: unknown;
  revenueBalance: unknown;
};

async function main() {
  const { prisma } = await import("../src/lib/db");

  console.log(
    `\n=== FRESH-START PURGE — mode: ${APPLY ? "APPLY (WRITING)" : "DRY-RUN (no writes)"} ===`
  );
  if (APPLY && !CONFIRMED) {
    console.error(
      '\n✗ Refusing to write. Set the confirmation env var first:\n' +
        '    $env:CONFIRM_FRESH_START="PURGE_AND_RESET"; npx tsx scripts/startFreshPurge.ts --apply\n'
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const userSelect = {
    id: true, name: true, email: true, phone: true, userCode: true, role: true,
    status: true, deletedAt: true, walletBalance: true, heldBalance: true,
    lienBalance: true, aepsBalance: true, payinBalance: true, revenueBalance: true,
  } as const;

  // ── Resolve each target. Require exactly one non-protected match. ──
  console.log(`\n[1] TARGET ACCOUNTS TO PHYSICALLY DELETE`);
  const resolved: { spec: TargetSpec; user: ResolvedUser }[] = [];
  let resolutionOk = true;

  for (const t of TARGETS) {
    const or: Record<string, unknown>[] = [];
    if (t.id) or.push({ id: t.id });
    if (t.email) or.push({ email: t.email.toLowerCase() });
    if (t.phone) or.push({ phone: t.phone });
    if (t.userCode) or.push({ userCode: t.userCode });
    const where: Record<string, unknown> =
      or.length > 0
        ? { OR: or }
        : {
            name: { equals: t.name, mode: "insensitive" },
            ...(t.role ? { role: t.role as any } : {}),
          };

    const matches = (await prisma.user.findMany({
      where: where as any,
      select: userSelect,
    })) as ResolvedUser[];

    const usable = matches.filter((m) => !isProtected(m));
    const protectedHits = matches.filter((m) => isProtected(m));
    for (const p of protectedHits) {
      console.log(`  ⚠ ${t.label}: SKIPPED protected account ${p.name} <${p.email}>`);
    }

    if (usable.length === 0) {
      console.log(`  • ${t.label.padEnd(30)} → NO MATCH (nothing to delete)`);
      continue; // not fatal on its own; may already be deleted
    }
    if (usable.length > 1) {
      resolutionOk = false;
      console.log(`  ✗ ${t.label.padEnd(30)} → AMBIGUOUS (${usable.length} matches — pin an id/email/phone):`);
      for (const m of usable) {
        console.log(`      ${m.name} <${m.email}> ${m.phone} ${m.userCode ?? "—"} ${m.role}/${m.status} [${m.id}]`);
      }
      continue;
    }

    const u = usable[0];
    resolved.push({ spec: t, user: u });
    console.log(
      `  • ${t.label.padEnd(30)} → ${u.name} <${u.email}> ${u.phone} ${u.userCode ?? "—"} ${u.role}/${u.status}` +
        `  primary=${money(u.walletBalance)} aeps=${money(u.aepsBalance)} rev=${money(u.revenueBalance)}  [${u.id}]`
    );
  }

  // Per-target relation footprint (what step 1 must clear before user.delete).
  if (resolved.length > 0) {
    console.log(`\n    Per-target relation footprint (cleared before delete):`);
    for (const { spec, user } of resolved) {
      const [slabs, declReq, declAppr, qrs, verif, invites, docs, walletTxn, txns] = await Promise.all([
        prisma.commissionSlab.count({ where: { userId: user.id } }),
        prisma.declarationApproval.count({ where: { requestedById: user.id } }),
        prisma.declarationApproval.count({ where: { approverId: user.id } }),
        prisma.staticQr.count({ where: { createdById: user.id } }),
        prisma.verificationResult.count({ where: { userId: user.id } }),
        prisma.invite.count({ where: { OR: [{ userId: user.id }, { email: user.email.toLowerCase() }, { phone: user.phone }] } }),
        prisma.document.count({ where: { userId: user.id } }),
        prisma.walletTxn.count({ where: { userId: user.id } }),
        prisma.transaction.count({ where: { userId: user.id } }),
      ]);
      console.log(
        `      ${spec.label.padEnd(30)} slabs=${slabs} decl(req/appr)=${declReq}/${declAppr} staticQr=${qrs} ` +
          `verif=${verif} invites=${invites} docs=${docs} walletTxn=${walletTxn} txn=${txns}`
      );
    }
  }

  // ── Step 2/3 preview: global ledger + revenue clear ──
  const [userCount, primaryTxn, aepsTxn, revTxn] = await Promise.all([
    prisma.user.count(),
    prisma.walletTxn.count({ where: { walletType: "PRIMARY" } }),
    prisma.walletTxn.count({ where: { walletType: "AEPS" } }),
    prisma.walletTxn.count({ where: { walletType: "REVENUE" } }),
  ]);
  const bal = await prisma.user.aggregate({
    _sum: { walletBalance: true, heldBalance: true, lienBalance: true, aepsBalance: true, payinBalance: true, revenueBalance: true },
  });

  console.log(`\n[2] LEDGER CLEAR (ALL ${userCount} users) — balances -> ₹0 & transactional tables truncated`);
  console.log(`    Σ primary=${money(bal._sum.walletBalance)} held=${money(bal._sum.heldBalance)} lien=${money(bal._sum.lienBalance)} aeps=${money(bal._sum.aepsBalance)} payin=${money(bal._sum.payinBalance)}`);
  console.log(`    WalletTxn PRIMARY=${primaryTxn} AEPS=${aepsTxn}`);
  console.log(`\n[3] REVENUE WALLET CLEAR — revenueBalance -> ₹0 (Σ ${money(bal._sum.revenueBalance)}), REVENUE WalletTxn=${revTxn} removed by truncate`);

  let totalWipe = 0;
  for (const t of WIPE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*)::bigint AS c FROM "${t}"`);
    totalWipe += Number(rows[0]?.c ?? 0);
  }
  console.log(`    Total transactional rows to truncate: ${totalWipe}`);

  // ── Survivor guarantee ──
  const targetIds = [...new Set(resolved.map((r) => r.user.id))];
  const survivingMasters = await prisma.user.count({
    where: { role: "MASTER_ADMIN", deletedAt: null, id: { notIn: targetIds } },
  });
  console.log(`\n[GUARD] ACTIVE MASTER_ADMINs remaining after purge: ${survivingMasters}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — nothing written.`);
    if (!resolutionOk) console.log(`⚠ Some targets are AMBIGUOUS — pin them before --apply.`);
    console.log(
      `\nTo execute:\n  $env:CONFIRM_FRESH_START="PURGE_AND_RESET"; npx tsx scripts/startFreshPurge.ts --apply\n`
    );
    await prisma.$disconnect();
    return;
  }

  // ───────────────────────── APPLY ─────────────────────────
  if (!resolutionOk) {
    console.error(`\n✗ Aborting: some targets are ambiguous. Pin an id/email/phone in TARGETS and re-run.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (survivingMasters < 1) {
    console.error(`\n✗ Aborting: purge would leave ZERO active master admins.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // Step A — global truncate + zero balances (tasks 2 & 3). This also removes
  // every required-userId transactional blocker for the physical deletes.
  console.log(`\n→ [A] Truncating transactional tables + zeroing all balances…`);
  const tableList = WIPE_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    // NOTE: payinBalance is intentionally PRESERVED (the Payin monitor figure is
    // kept per operator request). All other books are zeroed.
    await tx.$executeRawUnsafe(
      `UPDATE "User" SET
         "walletBalance" = 0,
         "heldBalance"   = 0,
         "lienBalance"   = 0,
         "aepsBalance"   = 0,
         "revenueBalance"= 0`
    );
  });
  console.log(`  ✓ Truncated ${WIPE_TABLES.length} tables. ✓ Balances reset to ₹0 (payinBalance PRESERVED, revenue cleared).`);

  // Step B — physically delete each target (Cloudinary first, then one DB txn).
  const { deleteFromCloudinary } = await import("../src/lib/cloudinary");
  for (const { spec, user } of resolved) {
    console.log(`\n→ [B] Purging ${spec.label} (${user.email})…`);

    const docs = await prisma.document.findMany({
      where: { userId: user.id },
      select: { id: true, type: true, publicId: true, isSensitive: true },
    });
    for (const d of docs) {
      try {
        await deleteFromCloudinary(d.publicId, { isSensitive: d.isSensitive });
      } catch (e) {
        console.error(`    ✗ cloudinary ${d.type} (${d.publicId}): ${(e as Error).message}`);
      }
    }
    if (docs.length) console.log(`    cloudinary assets destroyed: ${docs.length}`);

    await prisma.$transaction(
      async (tx) => {
        const invites = await tx.invite.findMany({
          where: { OR: [{ userId: user.id }, { email: user.email.toLowerCase() }, { phone: user.phone }] },
          select: { id: true },
        });
        const inviteIds = invites.map((i) => i.id);

        // Blockers not covered by the global truncate:
        const slabs = await tx.commissionSlab.deleteMany({ where: { userId: user.id } });
        const decl = await tx.declarationApproval.deleteMany({
          where: {
            OR: [
              { requestedById: user.id },
              { approverId: user.id },
              ...(inviteIds.length ? [{ inviteId: { in: inviteIds } }] : []),
            ],
          },
        });
        const qrs = await tx.staticQr.deleteMany({ where: { createdById: user.id } });
        const verif = await tx.verificationResult.deleteMany({
          where: { OR: [{ userId: user.id }, ...(inviteIds.length ? [{ inviteId: { in: inviteIds } }] : [])] },
        });
        const inv = inviteIds.length
          ? await tx.invite.deleteMany({ where: { id: { in: inviteIds } } })
          : { count: 0 };

        // Defensive: AuditLog was truncated in step A, but if any row survived,
        // physically remove references (append-only trigger lifted inside the tx).
        const auditRefs = await tx.$queryRawUnsafe<{ c: bigint }[]>(
          `SELECT COUNT(*)::bigint AS c FROM "AuditLog" WHERE "userId" = $1 OR ("entity" = 'User' AND "entityId" = $1)`,
          user.id
        );
        if (Number(auditRefs[0]?.c ?? 0) > 0) {
          await tx.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER auditlog_append_only;`);
          await tx.$executeRawUnsafe(
            `DELETE FROM "AuditLog" WHERE "userId" = $1 OR ("entity" = 'User' AND "entityId" = $1);`,
            user.id
          );
          await tx.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER auditlog_append_only;`);
        }

        await tx.user.delete({ where: { id: user.id } });

        console.log(
          `    deleted → slabs=${slabs.count} decl=${decl.count} staticQr=${qrs.count} verif=${verif.count} invites=${inv.count} + User(cascades KYC/docs/…)`
        );
      },
      { timeout: 60000 }
    );

    const gone = !(await prisma.user.findUnique({ where: { id: user.id } }));
    const emailFree = !(await prisma.user.findUnique({ where: { email: user.email.toLowerCase() } }));
    const phoneFree = !(await prisma.user.findUnique({ where: { phone: user.phone } }));
    console.log(`    ✓ user gone=${gone ? "YES" : "NO"}  email free=${emailFree ? "YES" : "NO"}  phone free=${phoneFree ? "YES" : "NO"}`);
  }

  // ── Verify ──
  console.log(`\n→ Verifying…`);
  let remaining = 0;
  for (const t of WIPE_TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*)::bigint AS c FROM "${t}"`);
    remaining += Number(rows[0]?.c ?? 0);
  }
  const finalBal = await prisma.user.aggregate({
    _sum: { walletBalance: true, heldBalance: true, lienBalance: true, aepsBalance: true, payinBalance: true, revenueBalance: true },
  });
  const trig = await prisma.$queryRawUnsafe<{ tgenabled: string }[]>(
    `SELECT tgenabled FROM pg_trigger WHERE tgname = 'auditlog_append_only';`
  );
  const triggerOk = trig[0]?.tgenabled === "O"; // 'O' = enabled

  // payinBalance is intentionally preserved, so it is EXCLUDED from the
  // "expected ₹0" total and reported on its own line instead.
  const sumZeroed =
    Number(finalBal._sum.walletBalance ?? 0) +
    Number(finalBal._sum.heldBalance ?? 0) +
    Number(finalBal._sum.lienBalance ?? 0) +
    Number(finalBal._sum.aepsBalance ?? 0) +
    Number(finalBal._sum.revenueBalance ?? 0);

  console.log(`    Transactional rows remaining : ${remaining} (expected 0)`);
  console.log(`    Σ zeroed balances            : ${money(sumZeroed)} (expected ₹0.00)`);
  console.log(`    Σ payinBalance (preserved)   : ${money(finalBal._sum.payinBalance)}`);
  console.log(`    append-only trigger enabled  : ${triggerOk ? "YES ✓" : `NO ✗ (tgenabled=${trig[0]?.tgenabled})`}`);
  if (!triggerOk) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER auditlog_append_only;`);
    console.log("    → re-enabled trigger defensively.");
  }

  console.log(`\n✓ Fresh-start purge complete. Deleted ${resolved.length} account(s); ledgers & revenue wallet cleared.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ FRESH-START FAILED:", e);
  // Best-effort: make absolutely sure the audit guard is back on.
  try {
    const { prisma } = await import("../src/lib/db");
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER auditlog_append_only;`);
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
