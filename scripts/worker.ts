/**
 * Paybridgex background worker (PM2 process, separate from the Next.js server).
 *
 * Why a separate process: heavy / external / money-moving calls (BulkPe payout
 * initiation, status reconciliation) must NOT run inside an HTTP request. The
 * API enqueues a job and returns fast; this worker drains the queue from the
 * IP-whitelisted EC2 box and finalizes via the shared idempotent service.
 *
 * Run locally:   npm run worker
 * Run on EC2:    pm2 start ecosystem.config.js   (app: paybridgex-worker)
 *
 * Env: needs DATABASE_URL/DIRECT_URL, APP_ENCRYPTION_KEY, PARTNER_PAYOUT_ENABLED
 * and BULKPE_* (see .env.example). We best-effort load a local .env via Node's
 * built-in loader; in production PM2/systemd supplies the environment.
 */
try {
  // Node 20.12+ : load .env without a dependency. Ignore if unavailable/missing.
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the process manager */
}

import * as Sentry from "@sentry/node";
import type PgBoss from "pg-boss";
import { getBoss, QUEUES } from "@/lib/queue";
import {
  processPayoutInitiate,
  reconcilePayout,
  reconcileStuckPayouts,
} from "@/lib/payout/service";
import { runMonthlyReKycSweep } from "@/lib/rekyc/sweep";
import { processKycVideoBaseline } from "@/lib/kyc/video/service";
import { runLedgerIntegrityAudit } from "@/lib/recon/integrity";
import { runDailyPayoutReconciliation } from "@/lib/recon/payouts";
import { runBbpsReconciliation } from "@/lib/recon/bbps";
import { sweepDisputeSlas } from "@/lib/disputes/service";
import { runSettlementAutosweep } from "@/lib/settlement/autosweep";
import { runT1SettlementSweep } from "@/lib/settlement/t1";
import { runPosT1SettlementSweep, runPosInstantSettlementSweep } from "@/lib/settlement/pos";
import { runPgT1SettlementSweep, runPgInstantSettlementSweep } from "@/lib/settlement/pg";
import { runQrT1SettlementSweep } from "@/lib/qr/claims";
import { runPosMirrorSettleSweep } from "@/lib/settlement/pos-mirror-settle";
import { runPosMirrorSweep, runPosRecentSweep } from "@/lib/pos/mirror-sweep";
import { runPosRentalBilling } from "@/lib/pos/rental";
import { syncPosMachines } from "@/lib/pos/assignments";
import { flags } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { deliverWebhook } from "@/lib/platform/webhooks";
import { runAmlSweep } from "@/lib/aml/engine";
import { runAuditAnchorJob } from "@/lib/audit/anchor";
import { runKycVideoRetention } from "@/lib/kyc/video/retention";
import { productionSecretIssues } from "@/lib/env";
import { purgeExpiredRateLimits } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { captureError, sendOpsAlert } from "@/lib/monitoring/alerts";

// The Next.js server initializes Sentry via src/instrumentation.ts, but this
// worker is a SEPARATE PM2 process that never loads that hook. Initialize the
// SDK here so money-moving job failures (payouts, reconciliation, settlement,
// AML) surface in Sentry instead of vanishing into a retry loop. Runs after the
// loadEnvFile() call above and after PM2 has injected the runtime environment,
// so SENTRY_DSN is present. captureError() (used throughout) forwards here.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    environment: process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    // No PII: do not attach request/user data or local variables (this process
    // handles account numbers, tokens and KYC identifiers).
    sendDefaultPii: false,
    includeLocalVariables: false,
    initialScope: { tags: { process: "worker" } },
  });
}

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[worker]", ...args);
}

async function main() {
  const boss = await getBoss();
  log("pg-boss started; registering handlers…");

  // QUEUES.PAYOUT_INITIATE — call BulkPe for an APPROVED payout.
  await boss.work<{ payoutRequestId: string }>(QUEUES.PAYOUT_INITIATE, async (jobs) => {
    for (const job of jobs) {
      const { payoutRequestId } = job.data;
      log(`payout.initiate ${payoutRequestId}`);
      await processPayoutInitiate(payoutRequestId);
    }
  });

  // QUEUES.PAYOUT_RECONCILE — per-row reconcile (data.payoutRequestId) OR the
  // scheduled sweep (no data) that polls all stuck PROCESSING rows.
  await boss.work<{ payoutRequestId?: string }>(QUEUES.PAYOUT_RECONCILE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data ?? {};
      if (data.payoutRequestId) {
        log(`payout.reconcile ${data.payoutRequestId}`);
        await reconcilePayout(data.payoutRequestId);
      } else {
        const { scanned } = await reconcileStuckPayouts();
        if (scanned > 0) log(`reconcile sweep: ${scanned} stuck payout(s) checked`);
      }
    }
  });

  // Fallback for missed webhooks: poll every 5 minutes. `schedule` is
  // idempotent by queue name, so re-running on restart is safe.
  await boss.schedule(QUEUES.PAYOUT_RECONCILE, "*/5 * * * *");

  // QUEUES.BBPS_RECONCILE — BulkPe BBPS has no webhooks; this sweep polls
  // all PROCESSING bill payments and settles/refunds them. Also verifies
  // recent terminal rows against the provider's books.
  await boss.work(QUEUES.BBPS_RECONCILE, async () => {
    const r = await runBbpsReconciliation();
    if (!r.skipped) {
      log(
        `bbps.reconcile: drained=${r.drained} settled=${r.settled} refunded=${r.refunded} ` +
          `stuck=${r.stuck} verified=${r.verified} mismatches=${r.mismatches}`
      );
    }
  });
  await boss.schedule(QUEUES.BBPS_RECONCILE, "*/5 * * * *");

  // QUEUES.REKYC_MONTHLY — flag all ACTIVE network users for re-verification.
  // The sweep is internally idempotent, so a duplicate/retried delivery is safe.
  await boss.work(QUEUES.REKYC_MONTHLY, async () => {
    const { flagged, dueAt } = await runMonthlyReKycSweep();
    log(`rekyc.monthly: flagged ${flagged} network user(s); due ${dueAt.toISOString()}`);
  });

  // Run at 00:00 on the 1st of every month, in the server's operating timezone
  // (Asia/Kolkata / IST). `schedule` is keyed by queue name, so re-scheduling on
  // each worker restart simply overwrites the existing cron — no duplicates.
  await boss.schedule(QUEUES.REKYC_MONTHLY, "0 0 1 * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.KYC_VIDEO_BASELINE — Phase 14. After a network user uploads their
  // liveness video, extract a face frame (ffmpeg) and register the eKYC Hub
  // baseline. Idempotent per KycVideo id; safe on retry/duplicate delivery.
  await boss.work<{ kycVideoId: string }>(QUEUES.KYC_VIDEO_BASELINE, async (jobs) => {
    for (const job of jobs) {
      const { kycVideoId } = job.data;
      log(`kyc.video.baseline ${kycVideoId}`);
      await processKycVideoBaseline(kycVideoId);
    }
  });

  // QUEUES.RECON_DAILY — nightly money-safety sweep. Each stage is isolated so
  // one failure never blocks the others; every failure is captured + alerted.
  await boss.work(QUEUES.RECON_DAILY, async () => {
    log("recon.daily: starting…");

    try {
      const audit = await runLedgerIntegrityAudit();
      log(
        `recon.daily: ledger audit checked ${audit.usersChecked} user(s), ` +
          `${audit.findings.length} mismatch(es)`
      );
    } catch (e) {
      await captureError(e, { where: "recon.daily/ledger-audit", severity: "critical" });
    }

    try {
      const payout = await runDailyPayoutReconciliation();
      log(
        `recon.daily: payout recon drained=${payout.drained} stuck=${payout.stuck} ` +
          `verified=${payout.verified} mismatches=${payout.mismatches}` +
          (payout.skipped ? " (skipped — partner disabled)" : "")
      );
    } catch (e) {
      await captureError(e, { where: "recon.daily/payout-recon", severity: "critical" });
    }

    try {
      const bbps = await runBbpsReconciliation();
      log(
        `recon.daily: bbps recon drained=${bbps.drained} settled=${bbps.settled} ` +
          `refunded=${bbps.refunded} stuck=${bbps.stuck} verified=${bbps.verified} ` +
          `mismatches=${bbps.mismatches}` +
          (bbps.skipped ? " (skipped — partner disabled)" : "")
      );
    } catch (e) {
      await captureError(e, { where: "recon.daily/bbps-recon", severity: "critical" });
    }

    try {
      const purgedRl = await purgeExpiredRateLimits();
      const purgedIdem = await prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      log(
        `recon.daily: housekeeping purged ${purgedRl} rate-limit row(s), ` +
          `${purgedIdem.count} idempotency row(s)`
      );
    } catch (e) {
      await captureError(e, { where: "recon.daily/housekeeping" });
    }
  });

  // 02:30 IST daily — after the day's settlement window, before business hours.
  await boss.schedule(QUEUES.RECON_DAILY, "30 2 * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.DISPUTE_SLA — Phase 3. Stamp SLA breaches once, escalate priority,
  // alert ops. Sweep is idempotent (slaBreachedAt filter), so duplicate
  // deliveries are harmless.
  await boss.work(QUEUES.DISPUTE_SLA, async () => {
    const { breached } = await sweepDisputeSlas();
    if (breached > 0) log(`dispute.sla: ${breached} SLA breach(es) flagged`);
  });
  await boss.schedule(QUEUES.DISPUTE_SLA, "*/30 * * * *");

  // QUEUES.SETTLEMENT_AUTOSWEEP — Phase 3. Daily 19:30 IST (after the day's
  // trade, before the IMPS evening rush). Internally idempotent per IST day.
  await boss.work(QUEUES.SETTLEMENT_AUTOSWEEP, async () => {
    const result = await runSettlementAutosweep();
    log(
      result.swept
        ? `settlement.autosweep: swept ₹${result.amount}`
        : `settlement.autosweep: skipped (${result.reason})`
    );
  });
  await boss.schedule(QUEUES.SETTLEMENT_AUTOSWEEP, "30 19 * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.SETTLEMENT_T1 — admin console Phase 4. Scheduled hourly; fires the
  // AEPS→PRIMARY sweep only at the operator-configured IST hour. Safe to fire
  // repeatedly: each (user, day) settles at most once via the SettlementRun
  // unique key + ledger idempotency.
  await boss.work(QUEUES.SETTLEMENT_T1, async () => {
    const t1 = await getSetting("settlement.t1");
    const istHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hour12: false,
      }).format(new Date())
    );
    if (!t1.enabled || t1.paused || istHour !== t1.hour) return;
    const r = await runT1SettlementSweep();
    log(
      `settlement.t1: processed=${r.processed} settled=${r.settled} ` +
        `skipped=${r.skipped} failed=${r.failed} amount=₹${r.totalAmount}`
    );
  });
  await boss.schedule(QUEUES.SETTLEMENT_T1, "5 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.POS_INGEST — MIRROR-DRIVEN settlement sweep. The mirror read-model is
  // the single source of truth for POS transactions; this reads CAPTURED rows
  // for terminals assigned to an active, schemed retailer and feeds each into
  // the settlement engine (PENDING/INSTANT entry + upline commission). No second
  // partner pull. Runs every 10 min so the day's captures are queued well before
  // the T+1 settlement hour; idempotent per txn ref, so overlaps never double-book.
  // `noScheme` counts captures on assigned terminals that couldn't be priced
  // (retailer has no matching scheme/rate) — surfaced so admins can fix pricing.
  await boss.work(QUEUES.POS_INGEST, async () => {
    const r = await runPosMirrorSettleSweep();
    if (!r.skipped && (r.queued > 0 || r.noScheme > 0))
      log(
        `pos.settle.sweep: terminals=${r.eligibleTerminals} scanned=${r.scanned} ` +
          `queued=${r.queued} dup=${r.duplicate} noScheme=${r.noScheme} skipped=${r.skippedRows}`
      );
    if (!r.skipped && r.noScheme > 0)
      await sendOpsAlert({
        title: "POS captures on assigned terminals could not be priced",
        severity: "warning",
        details: {
          noScheme: r.noScheme,
          hint: "Assign a scheme/MDR slab (check the acquiring-company dimension) for these retailers.",
        },
      }).catch(() => {});
  });
  await boss.schedule(QUEUES.POS_INGEST, "*/10 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.POS_SETTLEMENT_T1 — POS acquirer T+1 settlement. Scheduled hourly;
  // fires the sweep only at the operator-configured IST hour (PlatformSetting
  // "settlement.pos_t1"). Only entries captured before the current IST day are
  // due (true T+1); each entry settles at most once via the pos-settle:<ref>
  // ledger idempotency key, so duplicate fires are harmless.
  await boss.work(QUEUES.POS_SETTLEMENT_T1, async () => {
    const cfg = await getSetting("settlement.pos_t1");
    const istHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hour12: false,
      }).format(new Date())
    );
    if (!cfg.enabled || cfg.paused || istHour !== cfg.hour) return;
    const r = await runPosT1SettlementSweep();
    if (r.processed > 0)
      log(
        `pos.settlement.t1: processed=${r.processed} settled=${r.settled} ` +
          `failed=${r.failed} amount=₹${r.totalAmount}`
      );
  });
  await boss.schedule(QUEUES.POS_SETTLEMENT_T1, "10 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.POS_SETTLEMENT_INSTANT — instant-settlement safety net. The primary
  // instant path is the POS webhook (credit happens synchronously on capture);
  // this sweep retries any INSTANT-mode entries left PENDING (e.g. a wallet
  // credit that failed mid-webhook). Every 3 minutes; each entry settles at
  // most once via the pos-settle:<ref> ledger idempotency key.
  await boss.work(QUEUES.POS_SETTLEMENT_INSTANT, async () => {
    const r = await runPosInstantSettlementSweep();
    if (r.processed > 0)
      log(
        `pos.settlement.instant: processed=${r.processed} settled=${r.settled} ` +
          `failed=${r.failed} amount=₹${r.totalAmount}`
      );
  });
  await boss.schedule(QUEUES.POS_SETTLEMENT_INSTANT, "*/3 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.QR_SETTLEMENT_T1 — QR collection T+1 settlement. Scheduled hourly;
  // fires only at the operator-configured IST hour (PlatformSetting
  // "settlement.qr_t1"). Settles approved (SETTLEABLE) claims the retailer
  // didn't instant-settle, net of the scheme's T1 MDR. Each claim settles at
  // most once via the SETTLEABLE→SETTLED status gate + qrsettle:<id> ledger key.
  await boss.work(QUEUES.QR_SETTLEMENT_T1, async () => {
    const cfg = await getSetting("settlement.qr_t1");
    const istHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hour12: false,
      }).format(new Date())
    );
    if (!cfg.enabled || cfg.paused || istHour !== cfg.hour) return;
    const r = await runQrT1SettlementSweep();
    if (r.processed > 0)
      log(
        `qr.settlement.t1: processed=${r.processed} settled=${r.settled} ` +
          `failed=${r.failed} amount=₹${r.totalAmount}`
      );
  });
  await boss.schedule(QUEUES.QR_SETTLEMENT_T1, "12 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.PG_SETTLEMENT_T1 — PG acquirer T+1 settlement. Scheduled hourly;
  // fires only at the operator-configured IST hour (PlatformSetting
  // "settlement.pg_t1"). Only entries captured before the current IST day are
  // due (true T+1); each entry settles at most once via the pg-settle:<ref>
  // ledger idempotency key, so duplicate fires are harmless.
  await boss.work(QUEUES.PG_SETTLEMENT_T1, async () => {
    const cfg = await getSetting("settlement.pg_t1");
    const istHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hour12: false,
      }).format(new Date())
    );
    if (!cfg.enabled || cfg.paused || istHour !== cfg.hour) return;
    const r = await runPgT1SettlementSweep();
    if (r.processed > 0)
      log(
        `pg.settlement.t1: processed=${r.processed} settled=${r.settled} ` +
          `failed=${r.failed} amount=₹${r.totalAmount}`
      );
  });
  await boss.schedule(QUEUES.PG_SETTLEMENT_T1, "14 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.PG_SETTLEMENT_INSTANT — PG instant-settlement safety net. The primary
  // instant path is the PG confirmation (credit happens on confirmation); this
  // sweep retries any INSTANT-mode entries left PENDING (e.g. a wallet credit
  // that failed mid-flight). Every 3 minutes; each entry settles at most once
  // via the pg-settle:<ref> ledger idempotency key.
  await boss.work(QUEUES.PG_SETTLEMENT_INSTANT, async () => {
    const r = await runPgInstantSettlementSweep();
    if (r.processed > 0)
      log(
        `pg.settlement.instant: processed=${r.processed} settled=${r.settled} ` +
          `failed=${r.failed} amount=₹${r.totalAmount}`
      );
  });
  await boss.schedule(QUEUES.PG_SETTLEMENT_INSTANT, "*/3 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.POS_RENTAL_BILLING — admin console Phase 5. Runs every hour; only
  // fires billing when the current IST hour matches the admin-configured hour.
  // Idempotent per (subscription, YYYY-MM) via the unique invoice key.
  await boss.work(QUEUES.POS_RENTAL_BILLING, async () => {
    const cfg = await getSetting("pos.rental_billing");
    const istHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hour12: false,
      }).format(new Date())
    );
    if (istHour !== cfg.hour) return;
    const r = await runPosRentalBilling();
    if (r.processed > 0)
      log(`pos.rental.billing: billed=${r.billed} failed=${r.failed} skipped=${r.skipped}`);
  });
  await boss.schedule(QUEUES.POS_RENTAL_BILLING, "0 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.POS_MACHINE_SYNC — pull the Same Day terminal inventory into the
  // local mirror so the fleet page stays current without a manual Sync button.
  // The sync unions across machine_type partitions + repeated passes to defeat
  // the partner's unstable pagination, and only reconciles (removes/retires
  // absent rows) when the crawl verifiably covered the partner's reported total.
  // Idempotent and assignment-preserving, so overlapping/retried runs are safe.
  await boss.work(QUEUES.POS_MACHINE_SYNC, async () => {
    if (!flags.pos) return;
    try {
      const r = await syncPosMachines();
      if (r.created > 0 || r.removed > 0 || r.retired > 0 || !r.complete)
        log(
          `pos.machines.sync: distinct=${r.distinct} expected=${r.expected} ` +
            `complete=${r.complete} created=${r.created} updated=${r.updated} ` +
            `removed=${r.removed} retired=${r.retired} passes=${r.passes}`
        );
    } catch (e) {
      await captureError(e, { where: "pos.machines.sync" });
    }
  });
  await boss.schedule(QUEUES.POS_MACHINE_SYNC, "*/10 * * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.POS_MIRROR_SYNC — pull the Same Day transaction feed (ALL statuses,
  // tenant-wide) into the local `PosTransactionMirror` read-model that the
  // dashboard feed + exports serve from. Reconciliation net behind the capture
  // webhook: repairs missed webhooks and backfills non-CAPTURED rows. Reads the
  // partner but writes only our DB (moves no money); idempotent per txn ref, so
  // overlapping/retried runs are safe. Every 2 minutes keeps the feed fresh
  // while one tenant-wide sweep stays far under the partner's 100 req/min limit.
  await boss.work(QUEUES.POS_MIRROR_SYNC, async () => {
    if (!flags.pos) return;
    try {
      const r = await runPosMirrorSweep();
      if (!r.skipped && r.written > 0)
        log(
          `pos.mirror.sync: pages=${r.pages} scanned=${r.scanned} written=${r.written} ` +
            `skipped=${r.skippedRows}`
        );
    } catch (e) {
      await captureError(e, { where: "pos.mirror.sync" });
    }
  });
  await boss.schedule(QUEUES.POS_MIRROR_SYNC, "*/2 * * * *", {}, { tz: "Asia/Kolkata" });
  // Prime the mirror once at boot so the feed isn't empty before the first
  // scheduled tick (deduped by singletonKey so a restart storm won't pile up).
  if (flags.pos) {
    await boss.send(QUEUES.POS_MIRROR_SYNC, {}, { singletonKey: "pos.mirror.sync.boot" }).catch(() => {});
  }

  // Near-real-time "recent" poll. pg-boss cron can't go below 1 minute, so we
  // run a self-guarded in-process interval instead. Each tick pulls only the
  // last ~15 min (page 1 → one partner request), so new captures reach the
  // mirror within ~10s and the dashboard within another ≤4s (SSE refresh) —
  // ~7–14s end-to-end. The `running` guard drops a tick if the previous one is
  // still in flight (partner slow), so ticks never pile up. The 2-min
  // POS_MIRROR_SYNC sweep above stays the completeness net.
  if (flags.pos) {
    const POS_RECENT_POLL_MS = 10_000;
    let recentRunning = false;
    const recentTick = async () => {
      if (recentRunning) return;
      recentRunning = true;
      try {
        const r = await runPosRecentSweep();
        if (!r.skipped && r.written > 0)
          log(`pos.mirror.recent: scanned=${r.scanned} written=${r.written}`);
      } catch (e) {
        await captureError(e, { where: "pos.mirror.recent" });
      } finally {
        recentRunning = false;
      }
    };
    setInterval(() => void recentTick(), POS_RECENT_POLL_MS);
    log(`pos.mirror.recent: near-real-time poll every ${POS_RECENT_POLL_MS / 1000}s`);
  }

  // QUEUES.WEBHOOK_DELIVER — Phase 4. Signed partner webhook deliveries;
  // per-job retryLimit set at enqueue time, terminal failures alert ops.
  await boss.work<{ deliveryId: string }>(QUEUES.WEBHOOK_DELIVER, async (jobs) => {
    for (const job of jobs) {
      await deliverWebhook(job.data.deliveryId);
    }
  });

  // QUEUES.AML_SWEEP — Phase 5. Hourly transaction-monitoring sweep over the
  // current IST day. Idempotent per (user, rule, day) via the unique key.
  await boss.work(QUEUES.AML_SWEEP, async () => {
    const { scannedUsers, newAlerts } = await runAmlSweep();
    if (newAlerts > 0) log(`aml.sweep: ${newAlerts} new alert(s) across ${scannedUsers} user(s)`);
  });
  await boss.schedule(QUEUES.AML_SWEEP, "15 * * * *");

  // QUEUES.AUDIT_ANCHOR — Phase 5. Anchor yesterday's audit rows into the
  // hash chain and spot-verify the previous anchor. 00:20 IST daily.
  await boss.work(QUEUES.AUDIT_ANCHOR, async () => {
    await runAuditAnchorJob();
    log("audit.anchor: done");
  });
  await boss.schedule(QUEUES.AUDIT_ANCHOR, "20 0 * * *", {}, { tz: "Asia/Kolkata" });

  // QUEUES.KYC_VIDEO_RETENTION — Phase 5. Purge raw liveness videos past the
  // retention window (opt-in via KYC_VIDEO_RETENTION_ENABLED). 01:30 IST daily.
  await boss.work(QUEUES.KYC_VIDEO_RETENTION, async () => {
    const r = await runKycVideoRetention();
    if (!r.skipped) log(`kyc.video.retention: purged ${r.purged}, failed ${r.failed}`);
  });
  await boss.schedule(QUEUES.KYC_VIDEO_RETENTION, "30 1 * * *", {}, { tz: "Asia/Kolkata" });

  // Phase 5 — secrets hardening: loudly flag weak/missing production secrets
  // at startup (never crashes the worker; ops gets one alert per boot).
  const secretIssues = productionSecretIssues();
  if (secretIssues.length > 0) {
    log(`SECRETS WARNING: ${secretIssues.join(" | ")}`);
    await sendOpsAlert({
      title: "Production secrets hardening issues detected",
      severity: "critical",
      details: { issues: secretIssues.join("; ") },
    });
  }

  log(
    "ready · handlers: payout.initiate, payout.reconcile (*/5 * * * *), bbps.reconcile (*/5 * * * *), rekyc.monthly (0 0 1 * * IST), kyc.video.baseline, recon.daily (30 2 * * * IST), dispute.sla (*/30 * * * *), settlement.autosweep (30 19 * * * IST), settlement.t1 (5 * * * * IST), pos.settle.sweep (*/10 * * * * IST), pos.settlement.t1 (10 * * * * IST), pos.settlement.instant (*/3 * * * * IST), qr.settlement.t1 (12 * * * * IST), pg.settlement.t1 (14 * * * * IST), pg.settlement.instant (*/3 * * * * IST), pos.machines.sync (*/10 * * * * IST), pos.mirror.sync (*/2 * * * * IST), webhook.deliver, aml.sweep (15 * * * *), audit.anchor (20 0 * * * IST), kyc.video.retention (30 1 * * * IST)"
  );
}

async function shutdown(signal: string) {
  log(`${signal} received — draining and stopping…`);
  try {
    const boss: PgBoss = await getBoss();
    await boss.stop({ wait: true });
  } catch {
    /* already stopped */
  }
  // Flush any buffered Sentry events before the process exits.
  await Sentry.close(2000).catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal:", e);
  Sentry.captureException(e, { tags: { where: "worker.startup" }, level: "fatal" });
  await sendOpsAlert({
    title: "Background worker crashed at startup",
    severity: "critical",
    details: { error: String(e).slice(0, 300) },
  }).catch(() => {});
  await Sentry.close(2000).catch(() => {});
  process.exit(1);
});
