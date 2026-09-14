/**
 * Same Day webhook — signing contract test.
 *
 * Proves our inbound verifier (verifySamedayPosWebhook) agrees BYTE-FOR-BYTE
 * with Same Day's documented scheme, using the REAL signing secret from .env:
 *
 *   X-Sameday-Signature = HMAC_SHA256(secret, `${X-Sameday-Timestamp}.${rawBody}`)  (hex)
 *   X-Sameday-Timestamp = unix seconds
 *   Tolerance           = 5 minutes
 *
 * Usage:
 *   npx tsx scripts/test-sameday-webhook.ts
 *     → offline unit test of the verifier (VALID / INVALID / STALE).
 *
 *   npx tsx scripts/test-sameday-webhook.ts https://app.paybridgex.in/api/webhooks/sameday
 *     → ALSO fires a live, correctly-signed NO-OP event at the URL and asserts
 *       HTTP 200, then a tampered one and asserts HTTP 401. The no-op event
 *       (a POS notification with a non-CAPTURED status and NO delivery id) moves
 *       no money and writes no rows — safe to run against production post-deploy.
 *
 * Exit code is non-zero if any assertion fails.
 */
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env already provided by the shell */
}

import crypto from "crypto";
import { verifySamedayPosWebhook } from "@/lib/partners/sameday-pos";

const secret =
  process.env.SAMEDAY_WEBHOOK_SECRET || process.env.SAMEDAY_POS_WEBHOOK_SECRET;

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  const tag = pass ? "PASS" : "FAIL";
  if (!pass) failures++;
  console.log(`  [${tag}] ${name}${detail ? "  — " + detail : ""}`);
}

/** Same Day's signature: HMAC_SHA256(secret, `${ts}.${rawBody}`) in hex. */
function sign(ts: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret as string).update(`${ts}.${rawBody}`).digest("hex");
}

function nowSec(): string {
  return Math.floor(Date.now() / 1000).toString();
}

async function main() {
  console.log("Same Day webhook signing contract test\n");

  if (!secret) {
    console.error(
      "No secret found. Set SAMEDAY_POS_WEBHOOK_SECRET (or SAMEDAY_WEBHOOK_SECRET) in .env."
    );
    process.exit(2);
  }
  console.log(`Secret loaded: ${secret.slice(0, 6)}…${secret.slice(-4)} (len ${secret.length})\n`);

  // ── 1. Offline verifier contract ──────────────────────────────────────────
  console.log("1) Verifier contract (offline):");

  const body = { event: "pos.transaction", txnId: "TEST-123", mappedStatus: "PENDING", tid: "T-DUMMY", amount: 100 };
  const raw = JSON.stringify(body);
  const ts = nowSec();
  const sig = sign(ts, raw);

  check("correct signature + fresh ts → VALID", verifySamedayPosWebhook(raw, sig, ts) === "VALID");
  check("sha256= prefixed signature → VALID", verifySamedayPosWebhook(raw, `sha256=${sig}`, ts) === "VALID");
  check("tampered body → INVALID", verifySamedayPosWebhook(raw + " ", sig, ts) === "INVALID");
  check("tampered signature → INVALID", verifySamedayPosWebhook(raw, sig.replace(/.$/, (c) => (c === "0" ? "1" : "0")), ts) === "INVALID");
  check("missing signature → INVALID", verifySamedayPosWebhook(raw, null, ts) === "INVALID");
  check(
    "stale timestamp (>5 min) → STALE",
    verifySamedayPosWebhook(raw, sign((Number(ts) - 600).toString(), raw), (Number(ts) - 600).toString()) === "STALE"
  );
  check(
    "timestamp within tolerance (−60s) → VALID",
    verifySamedayPosWebhook(raw, sign((Number(ts) - 60).toString(), raw), (Number(ts) - 60).toString()) === "VALID"
  );

  // ── 2. Optional live round-trip ───────────────────────────────────────────
  const url = process.argv[2];
  if (url) {
    console.log(`\n2) Live round-trip against ${url}:`);

    const send = async (rawBody: string, signature: string, timestamp: string) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sameday-signature": signature,
          "x-sameday-timestamp": timestamp,
          "x-sameday-event": "pos.transaction",
          // no x-sameday-delivery → skips dedupe write (pure no-op)
        },
        body: rawBody,
      });
      return res.status;
    };

    try {
      const okStatus = await send(raw, sig, ts);
      check("valid signed no-op event → HTTP 200", okStatus === 200, `got ${okStatus}`);

      const badStatus = await send(raw, "deadbeef".repeat(8), ts);
      check("tampered signature → HTTP 401", badStatus === 401, `got ${badStatus}`);
    } catch (e) {
      check("live request reachable", false, String(e));
    }
  } else {
    console.log("\n(Skip live test — pass a URL as arg to smoke-test a deployed endpoint.)");
  }

  console.log("");
  if (failures > 0) {
    console.error(`❌ ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("✅ All checks passed — verifier matches Same Day's signing scheme.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
