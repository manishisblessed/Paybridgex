/**
 * Runtime environment loader.
 *
 * Design notes:
 * - All secrets are OPTIONAL at parse time. This lets `next build` succeed
 *   even when secrets are not present (e.g. on a CI runner that builds the
 *   container but does not need to invoke crypto/auth code paths).
 * - Use `requireEnv("KEY")` at the actual call site that needs the secret.
 *   That gives a clear runtime error pointing to the missing key.
 * - In production at runtime, a missing secret causes a 500 with a clear
 *   message — never a silent fallback to insecure defaults.
 */
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Auth — optional at parse time, enforced via requireEnv() at runtime.
  NEXTAUTH_SECRET: z.string().min(16).optional(),
  JWT_SECRET: z.string().min(16).optional(),
  APP_ENCRYPTION_KEY: z.string().min(16).optional(),

  // Neon — optional so the build pipeline doesn't fail without a DB.
  DATABASE_URL: z.string().min(20).optional(),
  DIRECT_URL: z.string().min(20).optional(),

  // Cloudinary — optional; used only when uploads are exercised.
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),

  // Partner toggles — default to false. Honoured by the partner factory.
  PARTNER_AEPS_ENABLED: z.string().default("false"),
  PARTNER_DMT_ENABLED: z.string().default("false"),
  PARTNER_UPI_ENABLED: z.string().default("false"),
  PARTNER_PAYOUT_ENABLED: z.string().default("false"),
  PARTNER_BBPS_ENABLED: z.string().default("false"),
  // Sub-toggle: hold ONLY the BulkPe BBPS rail (Same Day Pay2New keeps
  // serving credit-card bills) without touching the BulkPe token, which the
  // PG top-up and UPI payout rails still need.
  PARTNER_BBPS_BULKPE_ENABLED: z.string().default("true"),
  PARTNER_RECHARGE_ENABLED: z.string().default("false"),
  PARTNER_TRAVEL_ENABLED: z.string().default("false"),
  PARTNER_PAN_ENABLED: z.string().default("false"),
  PARTNER_SMS_ENABLED: z.string().default("false"),
  PARTNER_EMAIL_ENABLED: z.string().default("false"),
  PARTNER_VERIFICATION_ENABLED: z.string().default("false"),
  PARTNER_POS_ENABLED: z.string().default("false"),
  PARTNER_SETTLEMENT_ENABLED: z.string().default("false"),
  PARTNER_RECHARGEKIT_ENABLED: z.string().default("false"),
  PARTNER_ESIGN_ENABLED: z.string().default("false"),

  // Same Day Solution — POS Partner API
  SAMEDAY_POS_BASE_URL: z.string().url().default("https://api.samedaysolution.in"),
  SAMEDAY_POS_API_KEY: z.string().min(1).optional(),
  SAMEDAY_POS_API_SECRET: z.string().min(1).optional(),

  // Same Day Solution — BBPS-2 (Pay2New) credit card bill payments and
  // Settlement API. Both fall back to the POS key pair when unset (the admin
  // panel issues one key pair per partner account). Gated by flags.bbps /
  // flags.settlement respectively.
  SAMEDAY_BBPS_API_KEY: z.string().min(1).optional(),
  SAMEDAY_BBPS_API_SECRET: z.string().min(1).optional(),
  SAMEDAY_SETTLEMENT_API_KEY: z.string().min(1).optional(),
  SAMEDAY_SETTLEMENT_API_SECRET: z.string().min(1).optional(),

  // Same Day Solution — RechargeKit (CC-2) credit card payment rail.
  // Falls back to POS key pair when unset. Gated by flags.rechargekit.
  SAMEDAY_RECHARGEKIT_API_KEY: z.string().min(1).optional(),
  SAMEDAY_RECHARGEKIT_API_SECRET: z.string().min(1).optional(),

  // Phase 3 — settlement automation. A daily worker job sweeps the Same Day
  // partner-wallet balance above the float you keep, into a verified account.
  // All values in rupees. Requires flags.settlement + the account id from
  // POST /api/admin/settlement/accounts.
  SETTLEMENT_AUTOSWEEP_ENABLED: z.string().default("false"),
  SETTLEMENT_AUTOSWEEP_ACCOUNT_ID: z.string().min(1).optional(),
  SETTLEMENT_AUTOSWEEP_KEEP_BALANCE: z.string().default("10000"), // float left in the wallet
  SETTLEMENT_AUTOSWEEP_MIN_TRANSFER: z.string().default("1000"), // don't sweep dust
  SETTLEMENT_AUTOSWEEP_MODE: z.enum(["IMPS", "NEFT", "RTGS"]).default("IMPS"),

  // Leegality eSigning Gateway v3 — partner agreement execution.
  // Sandbox: https://sandbox.leegality.com/api  Prod: https://app1.leegality.com/api
  LEEGALITY_BASE_URL: z.string().url().default("https://sandbox.leegality.com/api"),
  LEEGALITY_AUTH_TOKEN: z.string().min(1).optional(),
  LEEGALITY_PROFILE_ID: z.string().min(1).optional(),

  // eKYC Hub
  EKYCHUB_USERNAME: z.string().min(1).optional(),
  EKYCHUB_API_TOKEN: z.string().min(1).optional(),
  EKYCHUB_BASE_URL: z.string().url().default("https://connect.ekychub.in/v3"),

  // Monthly Re-KYC gate (Phase 13). Method is configurable; defaults to
  // Aadhaar OTP eKYC. Face match (when selected) compares a fresh liveness
  // capture against the onboarding baseline via the eKYC Hub.
  REKYC_METHOD: z.enum(["aadhaar_otp", "face_match", "aadhaar_otp+face"]).default("aadhaar_otp"),
  REKYC_FACE_MATCH_THRESHOLD: z.string().default("80"),

  // ---------- Phase 14: Onboarding liveness video (private S3 + face baseline) ----------
  // The 10s liveness video for network users is stored in a PRIVATE S3 bucket
  // (Block Public Access, SSE-KMS, versioning, TLS-only). Credentials prefer the
  // EC2 IAM instance role; the access keys below are a local/dev fallback only.
  AWS_REGION: z.string().min(1).default("ap-south-1"),
  S3_KYC_BUCKET: z.string().min(1).optional(),
  S3_KMS_KEY_ID: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Max accepted liveness video size (bytes) and duration (seconds).
  KYC_VIDEO_MAX_BYTES: z.string().default("15728640"), // 15 MiB
  KYC_VIDEO_MAX_DURATION_SEC: z.string().default("12"),
  // Absolute path to the ffmpeg/ffprobe binaries on EC2 (apt install ffmpeg).
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),

  // BulkPe — Payouts, Simple PG and BBPS bill payments share this one token.
  // Payouts gate on PARTNER_PAYOUT_ENABLED (flags.payout); BBPS gates on
  // PARTNER_BBPS_ENABLED (flags.bbps). Needs a static Elastic IP whitelisted
  // with BulkPe (see docs/PAYOUT.md).
  BULKPE_BASE_URL: z.string().url().default("https://api.bulkpe.in/client"),
  BULKPE_TOKEN: z.string().min(1).optional(),
  // BBPS-scoped token. BulkPe issues a separate token for the BBPS product;
  // when set it is used for all BBPS calls, otherwise BULKPE_TOKEN is used.
  BULKPE_BBPS_TOKEN: z.string().min(1).optional(),
  BULKPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // ---------- Security controls (see SECURITY.md) ----------
  // Cloudflare Turnstile (bot / CAPTCHA). When SECURITY_CAPTCHA_ENABLED="true"
  // the secret MUST be present or sensitive auth endpoints fail closed.
  SECURITY_CAPTCHA_ENABLED: z.string().default("false"),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  // Have-I-Been-Pwned breached-password check (k-anonymity range API).
  SECURITY_HIBP_ENABLED: z.string().default("true"),

  // Step-up 2FA on sensitive money-moving / config actions. Off by default so
  // it can be switched on once the client step-up prompt is wired everywhere.
  SECURITY_STEPUP_ENABLED: z.string().default("false"),

  // Max JSON request body accepted by API routes (bytes). Defends against
  // memory-exhaustion / oversized-payload abuse at the edge (middleware).
  SECURITY_MAX_BODY_BYTES: z.string().default("1048576"), // 1 MiB

  // ---------- Ops alerting & risk rules (see src/lib/monitoring, src/lib/risk) ----------
  // Slack-compatible webhook for critical operational alerts (ledger
  // mismatches, stuck payouts, worker crashes). Unset = log-only.
  ALERT_WEBHOOK_URL: z.string().url().optional(),

  // Transaction risk engine. Enabled by default; limits are per rolling window.
  RISK_RULES_ENABLED: z.string().default("true"),
  RISK_DAILY_AMOUNT_CAP: z.string().default("500000"), // ₹ per user / 24h
  RISK_HOURLY_TXN_CAP: z.string().default("40"), // movements per user / 1h
  RISK_NIGHT_FACTOR: z.string().default("0.5"), // daily-cap multiplier 00:00–06:00 IST
  RISK_NEW_BENEFICIARY_CAP: z.string().default("25000"), // ₹ first payout to a new beneficiary
  RISK_NEW_BENEFICIARY_COOLING_HOURS: z.string().default("24"),

  // ---------- Phase 5: compliance maturity (see src/lib/aml, src/lib/audit) ----------
  // AML transaction monitoring — hourly sweep files alerts for compliance
  // review (never auto-blocks). Thresholds in rupees; PMLA-informed defaults.
  AML_ENABLED: z.string().default("true"),
  AML_CTR_THRESHOLD: z.string().default("1000000"), // single/daily-aggregate CTR line
  AML_STRUCTURING_LINE: z.string().default("50000"), // the line smurfing stays under
  AML_STRUCTURING_MARGIN: z.string().default("0.1"), // "just below" = within 10% under the line
  AML_STRUCTURING_MIN_COUNT: z.string().default("3"), // movements/day to flag
  AML_DORMANT_DAYS: z.string().default("30"), // inactivity to count as dormant
  AML_DORMANT_BURST_AMOUNT: z.string().default("200000"), // dormant burst threshold

  // KYC-video retention purger — deletes raw biometric video from S3 after the
  // window (row metadata + baseline retained). DESTRUCTIVE: explicit opt-in.
  KYC_VIDEO_RETENTION_ENABLED: z.string().default("false"),
  KYC_VIDEO_RETENTION_DAYS: z.string().default("180")
});

/**
 * Empty strings in `.env` (e.g. `FOO=""`) fail `z.string().min(1).optional()`
 * and used to invalidate the *entire* schema.safeParse. The old fallback then
 * exposed raw `process.env`, which drops every Zod default — including
 * `SAMEDAY_POS_BASE_URL` → `undefined/api/partner/...` 500s.
 */
function normalizeEnv(raw: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) {
      out[key] = undefined;
      continue;
    }
    const trimmed = value.trim();
    out[key] = trimmed === "" ? undefined : value;
  }
  return out;
}

const parsed = schema.safeParse(normalizeEnv(process.env));

if (!parsed.success) {
  // Soft-warn; the build/runtime continues. Individual call sites that
  // require a missing key will throw via requireEnv().
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  // eslint-disable-next-line no-console
  console.warn(`[env] Some environment variables look invalid: ${issues}`);
}

// Always prefer a successful Zod parse (defaults applied). If parse still
// fails after normalization, merge defaults with whatever non-empty values
// we have so optional secrets never wipe required defaults.
export const env: z.infer<typeof schema> = parsed.success
  ? parsed.data
  : ({
      ...schema.parse({}),
      ...Object.fromEntries(
        Object.entries(normalizeEnv(process.env)).filter(([, v]) => v != null && v !== "")
      ),
    } as z.infer<typeof schema>);

/**
 * Throw a clear error if a required env var is missing at the moment a
 * runtime code path needs it. Use this inside the function that actually
 * uses the secret — never at module top-level.
 */
export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `[env] Missing required environment variable: ${String(key)}. ` +
        `Add it to your hosting provider's environment variables (Amplify / Vercel / etc.).`
    );
  }
  return value as NonNullable<(typeof env)[K]>;
}

export const flags = {
  aeps: env.PARTNER_AEPS_ENABLED === "true",
  dmt: env.PARTNER_DMT_ENABLED === "true",
  upi: env.PARTNER_UPI_ENABLED === "true",
  payout: env.PARTNER_PAYOUT_ENABLED === "true",
  bbps: env.PARTNER_BBPS_ENABLED === "true",
  bbpsBulkpe: env.PARTNER_BBPS_ENABLED === "true" && env.PARTNER_BBPS_BULKPE_ENABLED === "true",
  recharge: env.PARTNER_RECHARGE_ENABLED === "true",
  travel: env.PARTNER_TRAVEL_ENABLED === "true",
  pan: env.PARTNER_PAN_ENABLED === "true",
  sms: env.PARTNER_SMS_ENABLED === "true",
  email: env.PARTNER_EMAIL_ENABLED === "true",
  verification: env.PARTNER_VERIFICATION_ENABLED === "true",
  pos: env.PARTNER_POS_ENABLED === "true",
  settlement: env.PARTNER_SETTLEMENT_ENABLED === "true",
  settlementAutosweep: env.SETTLEMENT_AUTOSWEEP_ENABLED === "true",
  rechargekit: env.PARTNER_RECHARGEKIT_ENABLED === "true",
  esign: env.PARTNER_ESIGN_ENABLED === "true",

  // Security toggles
  captcha: env.SECURITY_CAPTCHA_ENABLED === "true",
  hibp: env.SECURITY_HIBP_ENABLED !== "false",
  stepUp: env.SECURITY_STEPUP_ENABLED === "true"
} as const;

export const isProd = env.NODE_ENV === "production";

/**
 * Phase 5 — secrets hardening. Audits the runtime environment for weak or
 * missing production secrets. Returns human-readable issues (empty = healthy).
 * Called at worker startup (logged + ops-alerted); intentionally NEVER throws
 * so a hardening finding can't take the platform down.
 */
export function productionSecretIssues(): string[] {
  if (!isProd) return [];
  const issues: string[] = [];

  const strong = (v: string | undefined, name: string, minLen = 32) => {
    if (!v) issues.push(`${name} is not set`);
    else if (v.length < minLen) issues.push(`${name} is shorter than ${minLen} chars — rotate to a stronger value`);
  };

  strong(env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET");
  strong(env.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  if (!env.DATABASE_URL) issues.push("DATABASE_URL is not set");
  if (env.DATABASE_URL?.includes("localhost")) issues.push("DATABASE_URL points at localhost in production");
  // The Tokyo project (ap-northeast-1) was retired in favour of the Mumbai
  // project (ap-south-1). Production must never silently fall back to it — that
  // splits writes across two databases (local vs prod drift).
  if (env.DATABASE_URL?.includes("ap-northeast-1")) {
    issues.push("DATABASE_URL points at the retired Tokyo project (ap-northeast-1) — production must use the Mumbai project (ap-south-1)");
  }

  // Placeholder values copied from .env.example must never reach production.
  const placeholderRe = /(changeme|change-me|example|placeholder|xxxx|your[-_])/i;
  for (const [key, value] of Object.entries({
    NEXTAUTH_SECRET: env.NEXTAUTH_SECRET,
    APP_ENCRYPTION_KEY: env.APP_ENCRYPTION_KEY,
    BULKPE_TOKEN: env.BULKPE_TOKEN,
    TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
    LEEGALITY_AUTH_TOKEN: env.LEEGALITY_AUTH_TOKEN,
  })) {
    if (value && placeholderRe.test(value)) issues.push(`${key} looks like a placeholder value`);
  }

  if (!env.ALERT_WEBHOOK_URL) {
    issues.push("ALERT_WEBHOOK_URL is not set — critical alerts are log-only");
  }

  return issues;
}

/** Max accepted JSON body size in bytes (used by middleware + route guards). */
export const MAX_BODY_BYTES = (() => {
  const n = Number(env.SECURITY_MAX_BODY_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 1_048_576;
})();
