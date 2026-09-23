import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPosMachines } from "@/lib/partners/sameday-pos";
import { isAdminRole, scopeDirectUserIdFilter } from "@/lib/security/ownership";
import type { SessionUser } from "@/lib/auth-server";
import type {
  PosMachine as ExternalPosMachine,
  PosMachinesQuery,
  LocalPosMachine,
  PosSyncResult,
} from "@/lib/partners/sameday-pos.types";

/**
 * POS assignment layer.
 *
 * Machines are sourced externally (Same Day Solution, read-only). We mirror
 * that inventory into the local `PosMachine` table so we can OWN the mapping
 * of a physical terminal to a platform user. The sync only ever touches the
 * denormalized display fields + `meta` — it never modifies the assignment
 * columns, which are our source of truth.
 */

const SYNC_PAGE_LIMIT = 100; // external API hard cap is 100/page
const MAX_PAGES = 50; // safety bound: up to 5,000 machines per sync
// The partner's list endpoint paginates without a stable ORDER BY, so a single
// crawl both duplicates some rows across page boundaries and silently skips
// others. We defeat this by crawling repeatedly and unioning the distinct IDs
// until we've covered the partner's reported total (or a pass adds nothing new).
const MAX_PASSES = 6;

type ExternalMachineRow = ExternalPosMachine;

/**
 * Acquiring-company label used across Brands & MDR (New brand picker, scheme
 * MDR picker, schemes/meta). Derived from the POS platform model rather than
 * the partner's own `company` field — that field is always "Same Day Solution"
 * and can't distinguish acquirers. Example: "Razorpay" -> "Sameday-Razorpay",
 * "Avika POS ( HDFC)" -> "Sameday-Avika POS ( HDFC)". Original casing is kept.
 */
export function posCompanyLabel(model: string | null | undefined): string | null {
  const m = (model ?? "").trim();
  return m ? `Sameday-${m}` : null;
}

/** Map an external machine into the columns we persist locally. */
function toSyncedFields(m: ExternalMachineRow) {
  const model = m.brand ?? m.machine_type ?? null;
  return {
    mid: m.mid ?? null,
    tid: m.tid ?? null,
    serial: m.serial_number ?? null,
    model,
    provider: "SAMEDAY",
    status: m.status ?? "active",
    location: m.location ?? null,
    city: m.city ?? null,
    state: m.state ?? null,
    company: posCompanyLabel(model),
    meta: m as unknown as object,
    syncedAt: new Date(),
  };
}

/** Upsert a single external machine, returning whether it was newly created. */
async function upsertMachine(m: ExternalMachineRow, existed: boolean): Promise<void> {
  const fields = toSyncedFields(m);
  await prisma.posMachine.upsert({
    where: { externalId: m.id },
    update: fields,
    create: { externalId: m.id, source: "SYNC", ...fields },
  });
  void existed;
}

type SyncCounters = { scanned: number; created: number; updated: number };

/**
 * Crawl every page of one partner-inventory slice (optionally filtered by
 * `query`, e.g. `{ machine_type }`), upserting only machines not already
 * captured this sync (the shared `seenIds` union) and recording any
 * `machine_type` values seen. Returns the highest `pagination.total` reported
 * during the crawl (the partner's claimed count for that slice).
 */
async function crawlOnePass(
  seenIds: Set<string>,
  counters: SyncCounters,
  discoveredTypes: Set<string>,
  query: PosMachinesQuery,
  requireFirstPage: boolean
): Promise<{ reportedTotal: number }> {
  let reportedTotal = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await getPosMachines({ page, limit: SYNC_PAGE_LIMIT, ...query });
    if (!res.ok) {
      // A hard failure on the very first request of the very first crawl is
      // fatal (nothing to fall back on). Otherwise we keep the union gathered
      // so far and let the completeness guard decide whether to reconcile.
      if (requireFirstPage && page === 1 && seenIds.size === 0) {
        throw new Error(
          res.error.error?.message ?? "Failed to fetch POS machines from provider"
        );
      }
      break;
    }

    const pg = res.data.pagination;
    if (pg?.total && pg.total > reportedTotal) reportedTotal = pg.total;

    const machines = res.data.data ?? [];
    if (machines.length === 0) break;

    for (const m of machines) {
      const t = (m.machine_type ?? "").trim();
      if (t) discoveredTypes.add(t);
    }

    // Skip machines already captured in an earlier page/slice of this sync.
    const fresh = machines.filter((m) => !seenIds.has(m.id));
    for (const m of machines) seenIds.add(m.id);

    if (fresh.length) {
      const existing = await prisma.posMachine.findMany({
        where: { externalId: { in: fresh.map((m) => m.id) } },
        select: { externalId: true },
      });
      const existingSet = new Set(existing.map((e) => e.externalId));

      // Upsert in parallel batches — full sequential upserts time out on first sync.
      const BATCH = 25;
      for (let i = 0; i < fresh.length; i += BATCH) {
        const slice = fresh.slice(i, i + BATCH);
        await Promise.all(slice.map((m) => upsertMachine(m, existingSet.has(m.id))));
        for (const m of slice) {
          counters.scanned++;
          if (existingSet.has(m.id)) counters.updated++;
          else counters.created++;
        }
      }
    }

    if (!pg?.has_next_page) break;
  }

  return { reportedTotal };
}

/**
 * Attach POS machines to the Brand that owns their acquiring company, by
 * matching `PosMachine.company` (e.g. "Sameday-Avika POS ( HDFC)") to
 * `Brand.name` (case-insensitive). Only fills rows whose `brandId` is still
 * null, so a machine already linked (manually or to another brand) is never
 * re-homed. This is the same "adopt the company's fleet" semantics as creating
 * a brand with `linkCompany`, applied continuously so the Brands page machine
 * count and per-brand MDR pricing stay correct as new terminals sync in.
 *
 * Returns the number of machines newly linked.
 */
export async function linkMachinesToBrands(): Promise<number> {
  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  let linked = 0;
  for (const b of brands) {
    const name = b.name.trim();
    if (!name) continue;
    const res = await prisma.posMachine.updateMany({
      where: { brandId: null, company: { equals: name, mode: "insensitive" } },
      data: { brandId: b.id },
    });
    linked += res.count;
  }
  return linked;
}

/**
 * Pull the full external machine inventory and upsert it into `PosMachine`.
 * Assignment fields are preserved for machines that remain in the feed.
 * Manual inventory rows (`source = MANUAL`) are never touched by sync.
 *
 * Resilience to unstable partner pagination
 * ------------------------------------------
 * The partner's list endpoint paginates without a stable ORDER BY, so a large
 * unfiltered crawl both duplicates some rows and permanently omits others
 * (observed: 254 rows served with 12 duplicates → only 242 distinct, dropping
 * live terminals such as 43133680, and repeating the crawl returns the identical
 * 242). Smaller filtered slices, however, are served in full. We therefore:
 *   1. PLAIN crawl once — captures the partner's reported total and discovers
 *      the `machine_type` partitions present.
 *   2. PARTITION union — crawl each `machine_type` and union the results. Each
 *      partition is small enough that the partner pages it completely, so the
 *      union recovers the terminals the plain crawl drops (POS 144 + WPOS 110 =
 *      254 = reported total).
 *   3. FALLBACK multi-pass — if still short, repeat plain crawls (union) to
 *      absorb any purely-random instability, up to `MAX_PASSES`.
 *   4. GUARD reconcile: destructive removal only runs when the crawl is
 *      verifiably complete — the union covered the partner's reported total, or
 *      the account is genuinely empty. A short crawl means pagination dropped
 *      rows, so we keep the existing mirror rather than churning live terminals.
 */
export async function syncPosMachines(): Promise<PosSyncResult> {
  const seenIds = new Set<string>();
  const counters = { scanned: 0, created: 0, updated: 0 };
  const discoveredTypes = new Set<string>();
  let reportedTotal = 0;
  let passes = 0;

  const covered = () => reportedTotal > 0 && seenIds.size >= reportedTotal;

  const runCrawl = async (query: PosMachinesQuery, requireFirstPage: boolean) => {
    passes++;
    const { reportedTotal: total } = await crawlOnePass(
      seenIds,
      counters,
      discoveredTypes,
      query,
      requireFirstPage
    );
    if (total > reportedTotal) reportedTotal = total;
  };

  // 1. Plain crawl — reported total + machine_type discovery.
  await runCrawl({}, true);

  // 2. Partition by machine_type — recovers what the plain page-walk drops.
  if (!covered()) {
    for (const type of Array.from(discoveredTypes)) {
      if (covered()) break;
      await runCrawl({ machine_type: type }, false);
    }
  }

  // 3. Fallback: repeat plain crawls until the union stops growing or covers
  //    the reported total. Guards against random (non-partitionable) instability.
  while (!covered() && passes < MAX_PASSES) {
    const before = seenIds.size;
    await runCrawl({}, false);
    if (seenIds.size === before) break; // converged — no new machines discoverable
  }

  const distinct = seenIds.size;
  const emptyAccount = reportedTotal === 0 && distinct === 0;
  const coveredTotal = reportedTotal > 0 && distinct >= reportedTotal;
  const complete = emptyAccount || coveredTotal;

  // Reconcile stale partner rows — but ONLY when the crawl is complete.
  //
  // A row is "stale" when it's a synced machine (source = SYNC) that was absent
  // from a COMPLETE pull. Under the partner's unstable pagination an incomplete
  // crawl omits live terminals; deleting everything it happened to skip would
  // churn real machines out of the mirror (the 43133680 disappearance). So when
  // the union is short of the reported total we skip destructive reconcile and
  // preserve the previously-synced rows until a complete crawl confirms removals.
  //
  // When reconciling, a blind `deleteMany` is still a footgun: a stale machine
  // that carries a rental (`PosSubscription`) would abort the whole delete on
  // the FK. So we split rows:
  //   • Safe rows (no subscriptions, no assignee) are hard-deleted — the
  //     `PosAssignmentLog` cascade clears their history for free.
  //   • In-use rows (live subscription or active assignee) are RETIRED in place
  //     (`decommissioned`) to preserve billing/assignment data and FK integrity.
  let removed = 0;
  let retired = 0;

  if (complete) {
    // `notIn: []` is "match all" in Prisma, so an empty feed reconciles the
    // whole SYNC mirror — correct when switching to an account with no terminals.
    const staleWhere: Prisma.PosMachineWhereInput = emptyAccount
      ? { source: "SYNC" }
      : { source: "SYNC", externalId: { notIn: Array.from(seenIds) } };

    const stale = await prisma.posMachine.findMany({
      where: staleWhere,
      select: {
        id: true,
        assignedUserId: true,
        _count: { select: { subscriptions: true } },
      },
    });

    const deletableIds: string[] = [];
    const retirableIds: string[] = [];
    for (const m of stale) {
      if (m._count.subscriptions > 0 || m.assignedUserId) retirableIds.push(m.id);
      else deletableIds.push(m.id);
    }

    removed = deletableIds.length
      ? (await prisma.posMachine.deleteMany({ where: { id: { in: deletableIds } } }))
          .count
      : 0;

    retired = retirableIds.length
      ? (
          await prisma.posMachine.updateMany({
            where: { id: { in: retirableIds } },
            data: { status: "decommissioned", syncedAt: new Date() },
          })
        ).count
      : 0;
  }

  // Adopt any freshly-synced (or previously-unlinked) terminals into the Brand
  // that owns their acquiring company, so the Brands page machine count and
  // per-brand MDR pricing reflect the fleet without a manual re-link step.
  const linked = await linkMachinesToBrands();

  return {
    ok: true,
    scanned: counters.scanned,
    created: counters.created,
    updated: counters.updated,
    removed,
    retired,
    linked,
    distinct,
    expected: reportedTotal,
    complete,
    passes,
  };
}

/** Raised by {@link applyAssignment} on an invalid backdated effective-from. */
export class AssignmentError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "AssignmentError";
  }
}

/**
 * Validate & clamp a backdated `effective-from` for a NEW assignment. The
 * resulting holding window [effectiveFrom, ∞) is what the settlement engine uses
 * to attribute money, so it MUST NOT overlap any prior holder's period —
 * otherwise a backdated assignment could retroactively settle another retailer's
 * swipes. Money-critical rules:
 *   • Must be a valid date, not in the future (60s clock-skew tolerance).
 *   • If the terminal is CURRENTLY held (an active holder we're about to close
 *     at `now`), backdating would overlap that holder — refuse; recall first.
 *   • Otherwise (from stock) it must be ≥ the most recent time the terminal left
 *     a holder (latest returnedDate) — i.e. only into the stock gap, never into
 *     a previous holder's period.
 * Returns the validated effective start to stamp on the window.
 */
async function resolveEffectiveFrom(
  tx: Prisma.TransactionClient,
  machineId: string,
  effectiveFrom: Date,
  now: Date,
  currentlyHeld: boolean
): Promise<Date> {
  if (Number.isNaN(effectiveFrom.getTime()))
    throw new AssignmentError("Invalid effective-from date.");

  const SKEW_MS = 60_000;
  if (effectiveFrom.getTime() > now.getTime() + SKEW_MS)
    throw new AssignmentError("Effective-from date cannot be in the future.");

  // Clamp trivial future skew back to now.
  const eff = effectiveFrom.getTime() > now.getTime() ? now : effectiveFrom;

  if (currentlyHeld && eff.getTime() < now.getTime()) {
    throw new AssignmentError(
      "This terminal is currently assigned to another holder — recall it first, then assign with an effective date. Backdating a live reassignment would overlap the current holder's settlements.",
      409
    );
  }

  // Floor: the last time the terminal left ANY holder's hands. Backdating before
  // this would reach into a previous holder's window.
  const logs = await tx.posAssignmentLog.findMany({
    where: { machineId, action: "assign", returnedDate: { not: null } },
    select: { returnedDate: true },
  });
  const latestReturned = logs.reduce<Date | null>((max, l) => {
    const d = l.returnedDate;
    if (!d) return max;
    return max && max.getTime() >= d.getTime() ? max : d;
  }, null);

  if (latestReturned && eff.getTime() < latestReturned.getTime()) {
    throw new AssignmentError(
      `Effective-from can't be earlier than ${latestReturned.toISOString()} — that period belongs to a previous holder of this terminal.`,
      409
    );
  }

  return eff;
}

/**
 * Move a machine to a new holder (or back to stock when `toUserId` is null)
 * inside an existing transaction, keeping the tracking-report lifecycle
 * coherent: the previous ACTIVE assignment entry is closed as RETURNED, and
 * the new entry starts ACTIVE (assign) or is a plain EVENT (unassign).
 *
 * `effectiveFrom` (audited admin override) backdates the holding window's start
 * so a retailer's genuine swipes taken BEFORE the system assignment (e.g. the
 * machine was physically in use before ops recorded it) settle to them. It is
 * strictly validated so it can never overlap a previous holder — see
 * {@link resolveEffectiveFrom}. Omit for the normal "starts now" assignment.
 */
export async function applyAssignment(
  tx: Prisma.TransactionClient,
  opts: {
    machineId: string;
    fromUserId: string | null;
    toUserId: string | null;
    byUserId: string;
    note?: string;
    returnReason?: string;
    effectiveFrom?: Date;
  }
) {
  const now = new Date();
  const action = opts.toUserId ? "assign" : "unassign";

  // Resolve the effective start of the new holding window. Backdating is only
  // meaningful when assigning, and is validated so it never overlaps a prior
  // holder's settled period.
  let effectiveAt = now;
  if (opts.toUserId && opts.effectiveFrom) {
    effectiveAt = await resolveEffectiveFrom(
      tx,
      opts.machineId,
      opts.effectiveFrom,
      now,
      opts.fromUserId != null
    );
  }

  const row = await tx.posMachine.update({
    where: { id: opts.machineId },
    data: {
      assignedUserId: opts.toUserId,
      assignedAt: opts.toUserId ? effectiveAt : null,
      assignedById: opts.toUserId ? opts.byUserId : null,
    },
    select: posMachineSelect,
  });

  await tx.posAssignmentLog.updateMany({
    where: { machineId: opts.machineId, status: "ACTIVE" },
    data: {
      status: "RETURNED",
      returnedDate: now,
      ...(opts.returnReason ? { returnReason: opts.returnReason } : {}),
    },
  });

  await tx.posAssignmentLog.create({
    data: {
      machineId: opts.machineId,
      action,
      fromUserId: opts.fromUserId ?? undefined,
      toUserId: opts.toUserId ?? undefined,
      byUserId: opts.byUserId,
      note: opts.note ?? undefined,
      status: action === "assign" ? "ACTIVE" : "EVENT",
      // Window start = the (validated) effective date. `createdAt` still records
      // when the admin actually performed the action, so the backdate is audited.
      assignedDate: action === "assign" ? effectiveAt : undefined,
      returnReason: action === "unassign" ? opts.returnReason ?? undefined : undefined,
    },
  });

  return row;
}

type PosMachineWithAssignee = {
  id: string;
  externalId: string;
  source: string;
  company: string | null;
  mid: string | null;
  tid: string | null;
  serial: string | null;
  model: string | null;
  provider: string;
  status: string;
  location: string | null;
  city: string | null;
  state: string | null;
  assignedUserId: string | null;
  assignedAt: Date | null;
  syncedAt: Date;
  brandId: string | null;
  brandRef: { id: string; name: string; key: string } | null;
  assignedUser: {
    id: string;
    name: string;
    phone: string;
    role: string;
  } | null;
};

/** Prisma `select` that includes the assignee summary for serialization. */
export const posMachineSelect = {
  id: true,
  externalId: true,
  source: true,
  company: true,
  mid: true,
  tid: true,
  serial: true,
  model: true,
  provider: true,
  status: true,
  location: true,
  city: true,
  state: true,
  assignedUserId: true,
  assignedAt: true,
  syncedAt: true,
  brandId: true,
  brandRef: {
    select: { id: true, name: true, key: true },
  },
  assignedUser: {
    select: { id: true, name: true, phone: true, role: true },
  },
} as const;

/**
 * Resolve which POS terminal IDs (`tid`) a user may query at the partner, each
 * with the holding WINDOW `[from, to]` during which the user owned it.
 *
 * The partner account is tenant-wide, so the partner-proxy routes
 * (transactions/export) would otherwise expose every terminal to any logged-in
 * user. Assignment is owned locally, so we scope non-admins to the terminals
 * assigned to them and their DIRECT children only (SD→MDs, MD→DTs, DT→RTs) —
 * never the full subtree. Admins are unrestricted.
 *
 * A transaction belongs to whoever held the terminal WHEN it was captured, so
 * visibility must survive the machine being unassigned/reassigned later. We
 * therefore resolve TWO kinds of windows and union them:
 *   • CURRENT holdings — the live `PosMachine.assignedUserId` column, as an
 *     OPEN-ENDED window (`to = null`). This is the source of truth for a
 *     freshly-assigned terminal, in scope even before any log row is stamped.
 *   • PAST holdings — CLOSED windows `[assignedDate, returnedDate]` recovered
 *     from the `PosAssignmentLog` ledger, so a previous holder keeps seeing the
 *     transactions captured on their watch after the machine moves on.
 *
 * These windows mirror the holder-attribution periods in `enrich.ts`, so scope
 * (who may query a row) and attribution (whose name a row shows) always agree.
 */
export type ScopedTerminal = { tid: string; from: Date | null; to: Date | null };

export async function scopePosTerminals(
  user: SessionUser
): Promise<{ all: boolean; tids: string[]; terminals: ScopedTerminal[] }> {
  if (isAdminRole(user.role))
    return { all: true, tids: [], terminals: [] };

  const scope = await scopeDirectUserIdFilter(user);

  const [current, past] = await Promise.all([
    // CURRENT holdings — open-ended (`to = null`).
    prisma.posMachine.findMany({
      where: { assignedUserId: scope.userId, tid: { not: null } },
      select: { tid: true, assignedAt: true },
    }),
    // PAST holdings — closed windows from the ledger. Only RETURNED "assign"
    // rows (returnedDate set) are past; the still-ACTIVE one is a current
    // holding already covered above.
    prisma.posAssignmentLog.findMany({
      where: {
        action: "assign",
        toUserId: scope.userId,
        returnedDate: { not: null },
        machine: { tid: { not: null } },
      },
      select: {
        assignedDate: true,
        createdAt: true,
        returnedDate: true,
        machine: { select: { tid: true } },
      },
    }),
  ]);

  const terminals: ScopedTerminal[] = [];
  for (const r of current) {
    if (r.tid) terminals.push({ tid: r.tid, from: r.assignedAt, to: null });
  }
  for (const p of past) {
    const tid = p.machine?.tid;
    if (tid) terminals.push({ tid, from: p.assignedDate ?? p.createdAt, to: p.returnedDate });
  }

  const tids = Array.from(new Set(terminals.map((t) => t.tid)));
  return { all: false, tids, terminals };
}

/**
 * Resolve an acquiring-company label (`PosMachine.company`, e.g.
 * "Sameday-Avika POS ( HDFC)") to the distinct terminal IDs booked under it.
 *
 * Admin-only convenience: the partner transactions feed filters by a single
 * `terminal_id`, so a per-company view needs the full TID list to aggregate
 * over. The window bounds are intentionally null — an admin sees ALL activity
 * on a company's terminals, so no per-holder time clamp is applied.
 */
export async function resolveCompanyTerminals(
  company: string
): Promise<ScopedTerminal[]> {
  const rows = await prisma.posMachine.findMany({
    where: { company, tid: { not: null } },
    select: { tid: true },
  });

  const seen = new Set<string>();
  const terminals: ScopedTerminal[] = [];
  for (const r of rows) {
    if (r.tid && !seen.has(r.tid)) {
      seen.add(r.tid);
      terminals.push({ tid: r.tid, from: null, to: null });
    }
  }
  return terminals;
}

/** Serialize a DB row (with assignee) into the API/UI shape. */
export function serializePosMachine(
  row: PosMachineWithAssignee
): LocalPosMachine {
  return {
    id: row.id,
    externalId: row.externalId,
    source: row.source,
    company: row.company,
    mid: row.mid,
    tid: row.tid,
    serial: row.serial,
    model: row.model,
    provider: row.provider,
    status: row.status,
    location: row.location,
    city: row.city,
    state: row.state,
    assignedUserId: row.assignedUserId,
    assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
    brandId: row.brandId,
    brand: row.brandRef
      ? { id: row.brandRef.id, name: row.brandRef.name, key: row.brandRef.key }
      : null,
    assignee: row.assignedUser
      ? {
          id: row.assignedUser.id,
          name: row.assignedUser.name,
          phone: row.assignedUser.phone,
          role: row.assignedUser.role,
        }
      : null,
    syncedAt: row.syncedAt.toISOString(),
  };
}
