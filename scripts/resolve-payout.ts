/**
 * Ops resolver for payouts HELD as NEEDS_REVIEW (indeterminate send outcome).
 *
 * A payout whose transfer response was lost (5xx / timeout / network) may have
 * been disbursed by the bank, so the hold is RETAINED. This tool lets ops:
 *   - LIST every held payout + current exposure.
 *   - For one payout: recover the lost Same Day reference (by matching amount +
 *     account last-4 + time against the rail's recent transactions), poll the
 *     authoritative status, and finalize — or, after a manual bank check, force
 *     the outcome (capture / release the hold).
 *
 * SAFE BY DEFAULT: without an explicit action it only READS. The recover/poll
 * paths never move money unless the rail reports a terminal state. The force_*
 * paths move money and REQUIRE CONFIRM=1.
 *
 * Usage (on the IP-whitelisted EC2 box):
 *   # list held payouts:
 *   ./node_modules/.bin/tsx scripts/resolve-payout.ts
 *   # auto-recover + poll one (no money unless rail is terminal):
 *   ID=<payoutId> ACTION=recover ./node_modules/.bin/tsx scripts/resolve-payout.ts
 *   # poll with a reference read from the Same Day panel:
 *   ID=<payoutId> ACTION=poll REF=<reference_id> ./node_modules/.bin/tsx scripts/resolve-payout.ts
 *   # force after a manual bank check (moves money — needs CONFIRM=1):
 *   ID=<payoutId> ACTION=force_paid UTR=<utr> CONFIRM=1 ./node_modules/.bin/tsx scripts/resolve-payout.ts
 *   ID=<payoutId> ACTION=force_failed NOTE="bank did not disburse" CONFIRM=1 ./node_modules/.bin/tsx scripts/resolve-payout.ts
 *
 * Optional:
 *   ACTOR=<userId>  admin user recorded on the audit (defaults to a MASTER_ADMIN).
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import {
  listHeldPayouts,
  resolveOnePayout,
  type ResolvePayoutAction,
} from "../src/lib/payout/service";

const ID = (process.env.ID ?? "").trim();
const ACTION = (process.env.ACTION ?? "").trim() as ResolvePayoutAction | "";
const REF = (process.env.REF ?? "").trim();
const UTR = (process.env.UTR ?? "").trim();
const NOTE = (process.env.NOTE ?? "").trim();
const CONFIRM = process.env.CONFIRM === "1";
let ACTOR = (process.env.ACTOR ?? "").trim();

const VALID: ResolvePayoutAction[] = ["recover", "poll", "force_paid", "force_failed"];

async function main() {
  // No ID → list the held queue and exit (read-only).
  if (!ID) {
    const held = await listHeldPayouts(500);
    const exposure = held.reduce((s, h) => s + h.totalDebit, 0);
    console.log(`\n=== Held payouts (NEEDS_REVIEW): ${held.length} · exposure ₹${exposure.toFixed(2)} ===\n`);
    for (const h of held) {
      console.log(
        `${h.id}  ₹${h.totalDebit.toFixed(2)}  ${h.mode}  ${h.beneficiaryName} ••${h.accountLast4 ?? "----"}  ` +
          `ref=${h.providerReferenceId}  rail=${h.providerTxnId ?? "(lost)"}  ` +
          `since=${h.processedAt ?? h.createdAt}  user=${h.userCode ?? h.userId}`
      );
    }
    console.log(
      "\nResolve one:  ID=<payoutId> ACTION=recover|poll|force_paid|force_failed [REF=] [UTR=] [NOTE=] [CONFIRM=1] ./node_modules/.bin/tsx scripts/resolve-payout.ts\n"
    );
    return;
  }

  if (!ACTION || !VALID.includes(ACTION as ResolvePayoutAction)) {
    console.error(`Set ACTION to one of: ${VALID.join(", ")}`);
    process.exit(1);
  }
  if (ACTION === "poll" && !REF) {
    console.error("ACTION=poll requires REF=<reference_id> (the Same Day reference, not a PO… id)");
    process.exit(1);
  }

  const row = await prisma.payoutRequest.findUnique({ where: { id: ID } });
  if (!row) {
    console.error(`No payout found for ${ID}`);
    process.exit(1);
  }
  console.log(`\n=== ${row.id} ===`);
  console.log(`status          : ${row.status}`);
  console.log(`amount/debit    : ${row.amount} / ${row.totalDebit}`);
  console.log(`beneficiary     : ${row.beneficiaryName} ••${row.accountLast4 ?? "----"} (${row.mode})`);
  console.log(`our ref         : ${row.providerReferenceId}`);
  console.log(`rail ref        : ${row.providerTxnId ?? "(lost)"}`);

  if (row.status !== "NEEDS_REVIEW") {
    console.log(`\nNot held (status ${row.status}) — nothing to resolve.`);
    return;
  }

  const movesMoney = ACTION === "force_paid" || ACTION === "force_failed";
  if (movesMoney && !CONFIRM) {
    console.log(
      `\n[dry-run] ACTION=${ACTION} would ${
        ACTION === "force_paid" ? "CAPTURE the hold (real debit)" : "RELEASE the hold to the wallet"
      }. Re-run with CONFIRM=1 to execute.`
    );
    return;
  }

  if (!ACTOR) {
    const master = await prisma.user.findFirst({ where: { role: "MASTER_ADMIN" }, select: { id: true } });
    ACTOR = master?.id ?? row.userId;
  }

  const result = await resolveOnePayout(row.id, {
    actorId: ACTOR,
    action: ACTION as ResolvePayoutAction,
    reference: REF || null,
    utr: UTR || null,
    note: NOTE || null,
  });

  console.log(`\nresult          : ${JSON.stringify(result)}`);
  if (result.changed) console.log(`✔ resolved → ${result.status}`);
  else console.log(`… still held (rail not terminal / no reference). Recon will keep polling.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
