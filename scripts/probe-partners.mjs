/**
 * Live partner connectivity probe — run on EC2 with env-paybridgex loaded.
 * Prints pass/fail only; never prints secrets.
 */
import crypto from "crypto";
import fs from "fs";
import { pathToFileURL } from "url";

function loadEnv(file) {
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

function present(k) {
  return Boolean(process.env[k] && String(process.env[k]).trim());
}

function flag(k) {
  return String(process.env[k] || "false").toLowerCase() === "true";
}

function samedaySign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function samedayGet(baseUrl, apiKey, apiSecret, path) {
  const bodyString = "";
  const ts = Date.now().toString();
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "x-signature": samedaySign(apiSecret, bodyString + ts),
      "x-timestamp": ts,
    },
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

async function probe() {
  const envFile = process.argv[2] || "/home/ubuntu/env-paybridgex";
  loadEnv(envFile);

  const base = process.env.SAMEDAY_POS_BASE_URL || "https://api.samedaysolution.in";
  const results = [];

  // 1) BulkPe fetchBalance
  {
    const name = "BulkPe fetchBalance";
    if (!present("BULKPE_TOKEN")) {
      results.push({ name, ok: false, detail: "BULKPE_TOKEN missing" });
    } else {
      try {
        const res = await fetch("https://api.bulkpe.in/client/fetchBalance", {
          headers: { authorization: `Bearer ${process.env.BULKPE_TOKEN}` },
        });
        const json = await res.json().catch(() => ({}));
        const ok = res.ok && json.status !== false;
        results.push({
          name,
          ok,
          detail: `HTTP ${res.status} status=${json.status} msg=${json.message || ""}`.trim(),
        });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  }

  // 2) Same Day POS health (public)
  {
    const name = "SameDay POS /pos-health";
    try {
      const res = await fetch(`${base}/pos-health`);
      const json = await res.json().catch(() => ({}));
      results.push({
        name,
        ok: res.ok,
        detail: `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`,
      });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message });
    }
  }

  // 3) Same Day BBPS billers
  {
    const name = "SameDay BBPS billers";
    const key = process.env.SAMEDAY_BBPS_API_KEY || process.env.SAMEDAY_POS_API_KEY;
    const secret = process.env.SAMEDAY_BBPS_API_SECRET || process.env.SAMEDAY_POS_API_SECRET;
    if (!key || !secret) {
      results.push({ name, ok: false, detail: "BBPS/POS keys missing" });
    } else {
      try {
        const { http, json } = await samedayGet(base, key, secret, "/api/partner/pay2new/billers");
        const ok = http === 200 && json.success === true;
        const count = Array.isArray(json.billers) ? json.billers.length : 0;
        results.push({
          name,
          ok,
          detail: `HTTP ${http} success=${json.success} billers=${count} err=${json.error?.message || json.error?.code || ""}`.trim(),
        });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  }

  // 4) Same Day Settlement balance
  {
    const name = "SameDay Settlement balance";
    const key = process.env.SAMEDAY_SETTLEMENT_API_KEY || process.env.SAMEDAY_POS_API_KEY;
    const secret = process.env.SAMEDAY_SETTLEMENT_API_SECRET || process.env.SAMEDAY_POS_API_SECRET;
    if (!key || !secret) {
      results.push({ name, ok: false, detail: "Settlement/POS keys missing" });
    } else {
      try {
        const { http, json } = await samedayGet(base, key, secret, "/api/partner/settlement/balance");
        const ok = http === 200 && json.success === true;
        results.push({
          name,
          ok,
          detail: `HTTP ${http} success=${json.success} err=${json.error?.message || json.error?.code || ""}`.trim(),
        });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  }

  // 5) Same Day POS machines (auth check)
  {
    const name = "SameDay POS machines";
    const key = process.env.SAMEDAY_POS_API_KEY;
    const secret = process.env.SAMEDAY_POS_API_SECRET;
    if (!key || !secret) {
      results.push({ name, ok: false, detail: "POS keys missing" });
    } else {
      try {
        const { http, json } = await samedayGet(base, key, secret, "/api/partner/pos-machines?page=1&limit=1");
        const ok = http === 200 && json.success !== false;
        results.push({
          name,
          ok,
          detail: `HTTP ${http} success=${json.success} err=${json.error?.message || json.error?.code || ""}`.trim(),
        });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  }

  // 6) Leegality stamp series list (lightweight auth check)
  {
    const name = "Leegality auth (series/list)";
    const token = process.env.LEEGALITY_AUTH_TOKEN;
    const lbase = (process.env.LEEGALITY_BASE_URL || "https://sandbox.leegality.com/api").replace(/\/+$/, "");
    if (!token) {
      results.push({ name, ok: false, detail: "LEEGALITY_AUTH_TOKEN missing" });
    } else {
      try {
        const res = await fetch(`${lbase}/v3.0/series/list`, {
          headers: { "X-Auth-Token": token },
        });
        const json = await res.json().catch(() => ({}));
        const ok = res.ok && json.status !== 0;
        results.push({
          name,
          ok,
          detail: `HTTP ${res.status} status=${json.status} msg=${json.messages?.[0]?.message || ""}`.trim(),
        });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  }

  // 7) eKYC Hub balance (auth via query params — matches adapter)
  {
    const name = "eKYC Hub balance";
    const user = process.env.EKYCHUB_USERNAME;
    const tok = process.env.EKYCHUB_API_TOKEN;
    const ebase = (process.env.EKYCHUB_BASE_URL || "https://connect.ekychub.in/v3").replace(/\/+$/, "");
    if (!user || !tok) {
      results.push({ name, ok: false, detail: "EKYCHUB creds missing" });
    } else {
      try {
        const url = new URL(`${ebase}/verification/balance`);
        url.searchParams.set("username", user);
        url.searchParams.set("token", tok);
        const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
        const json = await res.json().catch(() => ({}));
        const ok = res.ok && json.status === "Success";
        results.push({
          name,
          ok,
          detail: `HTTP ${res.status} status=${json.status} msg=${json.message || ""} balance=${json.balance ?? "n/a"}`.trim(),
        });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  }

  // 8) BulkPe BBPS listBillCategory
  {
    const name = "BulkPe BBPS listBillCategory";
    if (!present("BULKPE_TOKEN")) {
      results.push({ name, ok: false, detail: "BULKPE_TOKEN missing" });
    } else {
      try {
        const res = await fetch("https://api.bulkpe.in/client/bbps/listBillCategory", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.BULKPE_TOKEN}`,
          },
          body: "{}",
        });
        const json = await res.json().catch(() => ({}));
        const ok = res.ok && json.status !== false;
        const n = Array.isArray(json.data) ? json.data.length : 0;
        results.push({
          name,
          ok,
          detail: `HTTP ${res.status} status=${json.status} categories=${n} msg=${json.message || ""}`.trim(),
        });
      } catch (e) {
        results.push({ name, ok: false, detail: e.message });
      }
    }
  }

  console.log("=== Feature flags ===");
  for (const k of [
    "PARTNER_BBPS_ENABLED",
    "PARTNER_PAYOUT_ENABLED",
    "PARTNER_UPI_ENABLED",
    "PARTNER_POS_ENABLED",
    "PARTNER_SETTLEMENT_ENABLED",
    "PARTNER_ESIGN_ENABLED",
    "PARTNER_VERIFICATION_ENABLED",
    "PARTNER_EMAIL_ENABLED",
  ]) {
    console.log(`${k}=${process.env[k] ?? "<unset>"}`);
  }
  console.log(`LEEGALITY_PROFILE_ID=${present("LEEGALITY_PROFILE_ID") ? "SET" : "EMPTY/MISSING"}`);
  console.log("");
  console.log("=== Live partner probes ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log("");
  console.log(`Summary: ${results.length - failed}/${results.length} partner probes passed`);
  process.exit(failed ? 1 : 0);
}

probe().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(2);
});
