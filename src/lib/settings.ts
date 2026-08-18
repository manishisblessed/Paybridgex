import { z } from "zod";
import { prisma } from "./db";

/**
 * Platform settings — typed accessors over the PlatformSetting key-value
 * store. Every operational knob an admin can change at runtime lives here so
 * a config change never needs a deploy.
 *
 * Each key declares a zod schema + default. Reads fall back to the default
 * when the row is missing or fails validation (a bad manual edit can never
 * take the platform down). Writes validate before persisting.
 */

const SETTING_SCHEMAS = {
  /** Max PRIMARY wallet balance any network user may hold (₹). */
  "wallet.global_cap": z.object({
    enabled: z.boolean().default(true),
    amount: z.number().positive().default(500_000),
  }),

  /**
   * Max amount for a SINGLE admin wallet operation (PUSH/PULL), network
   * parent→child transfer, or lien. Enforced by the wallet-ops / network /
   * lien APIs so the ceiling can be raised for large enterprise movements
   * without a deploy. Hard-bounded to ₹100 crore to guard against fat-finger
   * / overflow inputs. Default ₹10 crore.
   */
  "wallet.op_max_amount": z.object({
    amount: z.number().positive().max(1_000_000_000).default(100_000_000),
  }),

  /**
   * Onboarding invite link validity. `days` is how long a freshly shared
   * onboarding link (and a targeted document re-upload link) stays usable
   * before it expires. Applied at creation/reshare time, so changing it only
   * affects links generated afterwards.
   */
  "onboarding.invite_expiry": z.object({
    days: z.number().int().min(1).max(90).default(30),
  }),

  /** @deprecated No longer enforced — admin wallet PUSH/PULL executes
   *  immediately for any authorized admin. Kept so existing stored rows
   *  validate. */
  "wallet.ops_approval_threshold": z.object({
    amount: z.number().nonnegative().default(50_000),
  }),

  /** @deprecated No longer enforced — reversals execute immediately for any
   *  authorized admin. Kept so existing stored rows validate. */
  "reversal.approval_threshold": z.object({
    amount: z.number().nonnegative().default(25_000),
  }),

  /** T+1 auto-settlement engine (AEPS wallet → primary wallet). */
  "settlement.t1": z.object({
    enabled: z.boolean().default(false),
    /** Cron hour (IST, 0-23) the daily run fires at. */
    hour: z.number().int().min(0).max(23).default(7),
    /** Global pause switch — overrides per-user configs. */
    paused: z.boolean().default(false),
    /** Minimum AEPS balance to bother settling (₹). */
    minAmount: z.number().nonnegative().default(100),
  }),

  /** POS rental billing job. */
  "pos.rental_billing": z.object({
    enabled: z.boolean().default(false),
    /** Cron hour (IST, 0-23) the daily billing run fires at. */
    hour: z.number().int().min(0).max(23).default(3),
  }),

  /**
   * POS rent waiver by business volume. When a machine does at least
   * `thresholdPerMachine` of POS business (gross transaction volume, all
   * payment modes) within its current billing cycle, that machine's monthly
   * rent is auto-waived — the subscriber is not debited and no commission
   * cascades up the chain for that machine that cycle. Evaluated per machine.
   */
  "pos.rental_waiver": z.object({
    enabled: z.boolean().default(false),
    /** Business (₹) a single machine must do in its cycle to waive its rent. */
    thresholdPerMachine: z.number().positive().default(5_000_000), // ₹50 lakh
  }),

  /** Default settlement tier caps applied when a user has no UserLimit row (₹). */
  "limits.settlement_defaults": z.object({
    dailyCap: z.number().positive().default(200_000),
    perTxnCap: z.number().positive().default(100_000),
  }),

  /** POS acquirer settlement — instant mode (admin-toggled per user, per brand, or global). */
  "settlement.pos_instant": z.object({
    /** Platform-wide default (overridden per-user by User.instantSettlement or per-brand). */
    defaultEnabled: z.boolean().default(false),
    /** Pause the instant safety-net sweep (webhook path is unaffected). */
    paused: z.boolean().default(false),
  }),

  /** POS T+1 settlement cron (for non-instant users). */
  "settlement.pos_t1": z.object({
    enabled: z.boolean().default(true),
    hour: z.number().int().min(0).max(23).default(9),
    paused: z.boolean().default(false),
    minAmount: z.number().nonnegative().default(50),
  }),

  /** PG acquirer settlement — instant mode (admin-toggled per user or global). */
  "settlement.pg_instant": z.object({
    /** Platform-wide default (overridden per-user by User.instantSettlement). */
    defaultEnabled: z.boolean().default(false),
    /** Pause the instant safety-net sweep (confirmation path is unaffected). */
    paused: z.boolean().default(false),
  }),

  /** PG T+1 settlement cron (for non-instant collections). */
  "settlement.pg_t1": z.object({
    enabled: z.boolean().default(true),
    hour: z.number().int().min(0).max(23).default(9),
    paused: z.boolean().default(false),
    minAmount: z.number().nonnegative().default(1),
  }),

  /**
   * QR collection T+1 settlement cron. Approved (SETTLEABLE) claims that the
   * retailer didn't instant-settle are swept the next IST day, net of the
   * scheme's T1 MDR. Retailer-driven instant settlement (T0) needs no cron.
   */
  "settlement.qr_t1": z.object({
    enabled: z.boolean().default(true),
    hour: z.number().int().min(0).max(23).default(9),
    paused: z.boolean().default(false),
    minAmount: z.number().nonnegative().default(1),
  }),

  /**
   * Retailer-facing INSTANT settlement button (the "Instant settle" action on
   * the POS / QR dashboards). Admin-controlled per rail: when a rail is
   * disabled, retailers cannot instant-settle (T0) — every transaction simply
   * auto-settles on the next-day T+1 cron. Ships disabled; an admin turns each
   * rail on when the client is ready to expose it.
   */
  "settlement.instant_button": z.object({
    /** Allow retailers to instant-settle POS proceeds (T0). */
    posEnabled: z.boolean().default(false),
    /** Allow retailers to instant-settle approved QR claims (T0). */
    qrEnabled: z.boolean().default(false),
    /** Allow retailers to instant-settle PG collections (T0). */
    pgEnabled: z.boolean().default(false),
  }),

  /**
   * POS capture ingestion sweep. Same Day doesn't POST capture webhooks, so a
   * worker cron pulls CAPTURED transactions from the partner API and creates
   * PENDING settlement entries (idempotent per txn ref). The T+1 sweep then
   * settles them on their capture day. This MOVES MONEY indirectly, so it can
   * be paused/disabled independently of the webhook path.
   */
  "settlement.pos_ingest": z.object({
    enabled: z.boolean().default(true),
    paused: z.boolean().default(false),
    /** How many days back to pull each run (covers late captures / retries). */
    lookbackDays: z.number().int().min(1).max(31).default(3),
    /** Safety cap on pages fetched per run (page_size 100). */
    maxPages: z.number().int().min(1).max(200).default(50),
  }),

  /**
   * Card CLASSIFICATION (card tier — PLATINUM / SIGNATURE / VISA REWARDS …).
   * Ships OFF: MDR is priced on Card CATEGORY (Credit/Debit/Prepaid) instead of
   * the tier. When disabled, the MDR resolver and brand rate picker ignore the
   * `classification` dimension (tier-pinned slabs stay in place but dormant),
   * the scheme/brand editors hide the Classification field, and the eKYC Hub
   * BIN checker stops running (no lookups, no balance spend). `showInUi`
   * independently controls whether the Classification column is shown in POS
   * transaction views.
   */
  "pos.card_classification": z.object({
    enabled: z.boolean().default(false),
    showInUi: z.boolean().default(false),
  }),

  /**
   * POS transaction MIRROR reconciliation sweep. Pulls the partner feed (ALL
   * statuses, tenant-wide) into the local `PosTransactionMirror` read-model so
   * the dashboard feed + exports serve from our DB instead of polling the
   * partner (which rate-limits at 100 req/min). This is the completeness net
   * behind the real-time capture webhook: it repairs missed webhooks and
   * backfills non-CAPTURED rows. Read-only against the partner (moves no money),
   * so it can run frequently; pause/disable independently if ever needed.
   */
  "pos.mirror_sync": z.object({
    enabled: z.boolean().default(true),
    paused: z.boolean().default(false),
    /** How many days back to pull each run (absorbs late/amended rows). */
    lookbackDays: z.number().int().min(1).max(31).default(2),
    /** Safety cap on pages fetched per run (page_size 100). */
    maxPages: z.number().int().min(1).max(500).default(100),
  }),

  /**
   * Default service allowlist granted to a NEW network user at creation, keyed
   * by role. Network users are default-disabled (an empty `enabledServices`
   * means NO access); these per-tier lists let an admin pre-enable a curated
   * starter set so every new signup of that role begins with those rails on,
   * without hand-editing each account. Empty (the ship default) means new users
   * start with NO services. Edited from Network Manager → "Default services for
   * new users"; also used by the `backfill:network-services` script.
   */
  "network.default_services": z.object({
    RETAILER: z.array(z.string()).default([]),
    DISTRIBUTOR: z.array(z.string()).default([]),
    MASTER_DISTRIBUTOR: z.array(z.string()).default([]),
    SUPER_DISTRIBUTOR: z.array(z.string()).default([]),
  }),
} as const;

/** Network (non-staff) roles that carry a per-tier default service allowlist. */
export const NETWORK_ROLES = [
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
] as const;
export type NetworkRole = (typeof NETWORK_ROLES)[number];

export function isNetworkRole(role: string): role is NetworkRole {
  return (NETWORK_ROLES as readonly string[]).includes(role);
}

export type SettingKey = keyof typeof SETTING_SCHEMAS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, key);
}

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

/** The validated default for a key (schema defaults applied to {}). */
export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTING_SCHEMAS[key].parse({}) as SettingValue<K>;
}

/** Absolute hard ceiling (₹) any wallet-op cap is bounded to (fat-finger guard). */
export const WALLET_OP_ABSOLUTE_MAX = 1_000_000_000;

/**
 * Effective max (₹) for a single admin wallet operation, network transfer, or
 * lien. Admin-configurable via the `wallet.op_max_amount` platform setting;
 * falls back to the ₹10 crore default when unset.
 */
export async function walletOpMaxAmount(): Promise<number> {
  return (await getSetting("wallet.op_max_amount")).amount;
}

/**
 * Default service keys granted to a NEW user of `role` at creation. Returns the
 * per-tier list from `network.default_services`; empty for non-network roles or
 * when the admin hasn't configured a starter set (default-disabled).
 */
export async function defaultServicesForRole(role: string): Promise<string[]> {
  if (!isNetworkRole(role)) return [];
  const cfg = await getSetting("network.default_services");
  return cfg[role] ?? [];
}

/** Read a setting, falling back to defaults when missing/invalid. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  if (!row) return settingDefault(key);
  const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
  return (parsed.success ? parsed.data : settingDefault(key)) as SettingValue<K>;
}

/** Validate + upsert a setting. Returns the stored value. */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: unknown,
  updatedById?: string
): Promise<SettingValue<K>> {
  const parsed = SETTING_SCHEMAS[key].parse(value) as SettingValue<K>;
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value: parsed as object, updatedById },
    create: { key, value: parsed as object, updatedById },
  });
  return parsed;
}

// ---------------------------------------------------------------------------
// Hot-path cached accessor for card classification.
//
// The MDR resolver, brand rate picker and BIN-lookup callers consult this on
// every priced transaction, so a DB read per call would be wasteful. Cache the
// value process-wide for a short TTL — a control toggle takes at most this long
// to propagate, which is fine for a pricing/display knob.
// ---------------------------------------------------------------------------
type CardClassificationSetting = SettingValue<"pos.card_classification">;
let _cardClassificationCache: { at: number; value: CardClassificationSetting } | null = null;
const CARD_CLASSIFICATION_TTL_MS = 30_000;

/** Card classification setting (enabled / showInUi), cached for {@link CARD_CLASSIFICATION_TTL_MS}. */
export async function getCardClassificationSetting(): Promise<CardClassificationSetting> {
  const now = Date.now();
  if (_cardClassificationCache && now - _cardClassificationCache.at < CARD_CLASSIFICATION_TTL_MS) {
    return _cardClassificationCache.value;
  }
  const value = await getSetting("pos.card_classification");
  _cardClassificationCache = { at: now, value };
  return value;
}

/** True when card classification (tier) is active for pricing + enrichment. */
export async function isCardClassificationEnabled(): Promise<boolean> {
  return (await getCardClassificationSetting()).enabled;
}

/** All settings with their current (or default) values — for the admin UI. */
export async function getAllSettings(): Promise<Record<SettingKey, unknown>> {
  const keys = Object.keys(SETTING_SCHEMAS) as SettingKey[];
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: keys } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingKey, unknown>;
  for (const key of keys) {
    const raw = byKey.get(key);
    const parsed = raw !== undefined ? SETTING_SCHEMAS[key].safeParse(raw) : null;
    out[key] = parsed?.success ? parsed.data : settingDefault(key);
  }
  return out;
}
