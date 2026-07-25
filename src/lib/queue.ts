import PgBoss from "pg-boss";

/**
 * Async job queue (pg-boss, backed by Postgres — no extra infra on the EC2 box).
 *
 * Why a queue: payment "hits" (BulkPe payout, BBPS, etc.) must NOT be processed
 * synchronously inside the HTTP request. The API enqueues a job and returns fast;
 * a separate worker process (PM2) drains the queue, calls the provider (from the
 * IP-whitelisted box), and finalizes via webhook/poll. This is what lets us
 * absorb bursts without exhausting the request thread pool or DB connections.
 *
 * The worker entrypoint (registered via `boss.work(...)`) lands in Phase 2.
 */

/** Stable queue names. Add new rails here as they are built. */
export const QUEUES = {
  PAYOUT_INITIATE: "payout.initiate",
  PAYOUT_RECONCILE: "payout.reconcile",
  // Phase 13 — monthly Re-KYC sweep. Scheduled "0 0 1 * *" (Asia/Kolkata) in the
  // worker; flags every ACTIVE network user (RT/DT/MD/SD) for re-verification.
  REKYC_MONTHLY: "rekyc.monthly",
  // Phase 14 — onboarding liveness baseline. After a network user uploads their
  // liveness video, this job (worker, IP-whitelisted box) downloads it, verifies
  // duration via ffprobe, extracts a face frame via ffmpeg, and registers the
  // eKYC Hub baseline. Heavy/external work — never run inside the HTTP request.
  KYC_VIDEO_BASELINE: "kyc.video.baseline",
  // Daily reconciliation sweep (02:30 IST): ledger integrity audit (balances
  // vs WalletTxn), deep payout reconciliation vs the provider's books, and
  // housekeeping (expired rate-limit / idempotency rows). See src/lib/recon/*.
  RECON_DAILY: "recon.daily",
  // Phase 3 — dispute SLA sweep (every 30 min): stamp breaches, escalate
  // priority, alert ops. See src/lib/disputes/service.ts.
  DISPUTE_SLA: "dispute.sla",
  // Phase 3 — settlement auto-sweep (daily): move surplus partner-wallet
  // balance at Same Day to the configured bank account. See
  // src/lib/settlement/autosweep.ts.
  SETTLEMENT_AUTOSWEEP: "settlement.autosweep",
  // Phase 4 — outbound partner webhooks: signed JSON POST per delivery row,
  // retried with backoff. See src/lib/platform/webhooks.ts.
  WEBHOOK_DELIVER: "webhook.deliver",
  // Phase 5 — AML transaction-monitoring sweep (hourly). Files AmlAlert rows
  // for compliance review. See src/lib/aml/engine.ts.
  AML_SWEEP: "aml.sweep",
  // Phase 5 — daily audit hash-chain anchor + verification of the previous
  // anchor. See src/lib/audit/anchor.ts.
  AUDIT_ANCHOR: "audit.anchor",
  // Phase 5 — KYC-video retention purger (daily, opt-in via env). Deletes raw
  // biometric video from S3 after the retention window; metadata retained.
  KYC_VIDEO_RETENTION: "kyc.video.retention",
  // Admin console Phase 4 — T+1 AEPS→PRIMARY settlement sweep. Scheduled
  // hourly; the handler fires the sweep only at the configured IST hour
  // (PlatformSetting "settlement.t1"), and each (user, day) settles at most
  // once. See src/lib/settlement/t1.ts.
  SETTLEMENT_T1: "settlement.t1",
  // Admin console Phase 5 — monthly POS rental billing (1st, 03:00 IST).
  // Debits each active subscription and raises invoices; idempotent per
  // (subscription, period). See src/lib/pos/rental.ts.
  POS_RENTAL_BILLING: "pos.rental.billing",
  // POS acquirer T+1 settlement — sweeps PENDING PosSettlementEntries into
  // retailer wallets daily at the configured IST hour.
  POS_SETTLEMENT_T1: "pos.settlement.t1",
  // POS acquirer instant-settlement safety net — retries any INSTANT-mode
  // entries left PENDING (e.g. webhook credit failed). Runs every few minutes;
  // the primary instant path is the POS webhook itself.
  POS_SETTLEMENT_INSTANT: "pos.settlement.instant",
  // POS capture ingestion — Same Day sends no capture webhooks, so this sweep
  // pulls CAPTURED transactions from the partner API and creates PENDING
  // settlement entries (idempotent per txn ref). Runs periodically before the
  // T+1 settlement hour. See src/lib/settlement/pos-ingest.ts.
  POS_INGEST: "pos.ingest",
  // BBPS bill payment reconciliation — polls PROCESSING BBPS transactions
  // and settles them. BulkPe BBPS has no webhooks, so this sweep is the
  // only way to finalize PENDING payments. Runs every 5 minutes.
  BBPS_RECONCILE: "bbps.reconcile",
  // QR collection T+1 settlement — sweeps approved (SETTLEABLE) claims the
  // retailer didn't instant-settle into their wallet the next IST day, net of
  // the scheme's T1 MDR. Scheduled hourly; fires only at the configured hour.
  QR_SETTLEMENT_T1: "qr.settlement.t1",
  // POS machine inventory sync — pulls the Same Day terminal inventory and
  // upserts the local `PosMachine` mirror (partition/multi-pass union +
  // reconcile guard). Scheduled every 10 min so the fleet stays current without
  // a manual Sync button. Fully idempotent; assignment data is preserved.
  POS_MACHINE_SYNC: "pos.machines.sync",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

let bossPromise: Promise<PgBoss> | null = null;

function connectionString(): string {
  // Prefer a direct (non-pooled) connection for pg-boss maintenance/polling.
  const cs = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!cs) {
    throw new Error(
      "[queue] DIRECT_URL or DATABASE_URL must be set to use the job queue."
    );
  }
  return cs;
}

/**
 * Lazily construct, start, and memoize the pg-boss instance, and ensure all
 * known queues exist (required by pg-boss v10+ before send/work).
 */
export async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({
        connectionString: connectionString(),
        // pg-boss creates and manages its own "pgboss" schema.
        schema: "pgboss",
      });
      boss.on("error", (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[queue] pg-boss error:", err);
      });
      await boss.start();
      for (const name of Object.values(QUEUES)) {
        await boss.createQueue(name);
      }
      return boss;
    })().catch((err) => {
      // Reset so a later call can retry instead of caching a failed start.
      bossPromise = null;
      throw err;
    });
  }
  return bossPromise;
}

export type EnqueueOptions = {
  /** Idempotency at the queue layer — pg-boss dedupes jobs sharing a singletonKey. */
  singletonKey?: string;
  /** Delay before the job becomes available, in seconds. */
  startAfterSec?: number;
  /** Retry attempts on failure. */
  retryLimit?: number;
  /** Backoff in seconds between retries. */
  retryDelaySec?: number;
};

/** Enqueue a job. Returns the job id (or null if deduped by singletonKey). */
export async function enqueue<T extends object>(
  queue: QueueName,
  data: T,
  opts: EnqueueOptions = {}
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queue, data, {
    singletonKey: opts.singletonKey,
    startAfter: opts.startAfterSec,
    retryLimit: opts.retryLimit ?? 5,
    retryDelay: opts.retryDelaySec ?? 30,
    retryBackoff: true,
  });
}
