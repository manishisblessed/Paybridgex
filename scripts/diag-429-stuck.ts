/**
 * READ-ONLY diagnostic. Mutates nothing.
 *
 * Answers: "Are transactions piling up behind a provider HTTP 429 (rate-limit)?"
 *
 *   1. All non-terminal txns (INITIATED / PROCESSING / NEEDS_REVIEW) by status,
 *      service and age — the backlog that failed to self-resolve.
 *   2. Any txn whose errorCode / errorMessage references 429 / rate-limit.
 *   3. Recent BBPS (Pay2New) error-code distribution over the last 24h, to see
 *      whether 429s are a one-off or a sustained throttling wave.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
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
loadEnv();

function age(from: Date): string {
  const mins = Math.floor((Date.now() - from.getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d${hrs % 24}h`;
}

async function main() {
  const { prisma } = await import("../src/lib/db");

  // ── 1. Non-terminal backlog ───────────────────────────────────────────────
  const nonTerminal = await prisma.transaction.findMany({
    where: {
      status: { in: ["INITIATED", "PROCESSING", "NEEDS_REVIEW"] },
      isSettlement: false,
    },
    select: {
      refId: true,
      status: true,
      service: true,
      partner: true,
      amount: true,
      fee: true,
      errorCode: true,
      errorMessage: true,
      partnerTxnId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("=== NON-TERMINAL backlog (INITIATED/PROCESSING/NEEDS_REVIEW) ===");
  console.log("total:", nonTerminal.length);
  const byStatus: Record<string, number> = {};
  const byService: Record<string, number> = {};
  for (const r of nonTerminal) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byService[r.service] = (byService[r.service] ?? 0) + 1;
  }
  console.log("by status :", JSON.stringify(byStatus));
  console.log("by service:", JSON.stringify(byService));

  console.log("\n--- each non-terminal txn (oldest first) ---");
  for (const r of nonTerminal) {
    const err = r.errorCode || r.errorMessage || "";
    console.log(
      `${r.refId.padEnd(16)} ${r.status.padEnd(12)} ${String(r.service).padEnd(16)} ` +
        `age=${age(r.createdAt).padEnd(7)} ptxn=${(r.partnerTxnId ?? "-").slice(0, 18).padEnd(18)} ${String(err).slice(0, 48)}`
    );
  }

  // ── 2. Anything referencing 429 / rate-limit ──────────────────────────────
  const since24 = new Date(Date.now() - 24 * 60 * 60_000);
  const rl = await prisma.transaction.findMany({
    where: {
      createdAt: { gte: since24 },
      OR: [
        { errorCode: { contains: "429" } },
        { errorMessage: { contains: "429" } },
        { errorMessage: { contains: "rate", mode: "insensitive" } },
        { errorMessage: { contains: "too many", mode: "insensitive" } },
      ],
    },
    select: {
      refId: true,
      status: true,
      service: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\n=== txns referencing 429 / rate-limit (last 24h): ${rl.length} ===`);
  for (const r of rl) {
    console.log(
      `${r.createdAt.toISOString().slice(5, 19)}  ${r.refId.padEnd(16)} ${r.status.padEnd(12)} ` +
        `${String(r.errorCode ?? "").padEnd(12)} ${String(r.errorMessage ?? "").slice(0, 50)}`
    );
  }

  // ── 3. PartnerApiLog: raw provider HTTP status distribution (last 24h) ─────
  // The durable call log records the real httpStatus per provider call, so a
  // 429 wave shows here even when the txn error text is sanitized.
  try {
    const logs: Array<{ httpStatus: number | null; path: string | null; count: bigint }> =
      await prisma.$queryRawUnsafe(
        `SELECT "httpStatus", "path", COUNT(*)::bigint AS count
         FROM "PartnerApiLog"
         WHERE "createdAt" >= $1
         GROUP BY "httpStatus", "path"
         ORDER BY count DESC
         LIMIT 40`,
        since24
      );
    console.log("\n=== PartnerApiLog httpStatus x path (last 24h) ===");
    for (const l of logs) {
      console.log(`  http=${String(l.httpStatus ?? "null").padEnd(5)} x${String(l.count).padEnd(6)} ${l.path ?? ""}`);
    }
    const total429 = logs.filter((l) => l.httpStatus === 429).reduce((a, l) => a + Number(l.count), 0);
    console.log(`\n  >>> total HTTP 429 provider calls in last 24h: ${total429}`);
  } catch (e) {
    console.log("\n(PartnerApiLog query skipped:", (e as Error).message, ")");
  }

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
