import { Prisma } from "@prisma/client";

/**
 * Minimal in-memory Prisma stand-in for unit-testing the money paths
 * (ledger.ts, services/transaction.ts) without a real Postgres. Implements
 * only the exact calls those modules make. Transactions are executed
 * inline (single-threaded test runner), which preserves the code paths but
 * not real row locking — concurrency is covered by the separate
 * scripts/test-ledger-concurrency.ts stress script against a live DB.
 */

type Row = Record<string, unknown>;

let seq = 0;
const nextId = () => `fake_${++seq}`;

function decOf(v: unknown): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(typeof v === "number" ? v.toString() : String(v ?? 0));
}

export class FakeDb {
  users = new Map<string, Row>();
  walletTxns: Row[] = [];
  transactions: Row[] = [];
  auditLogs: Row[] = [];
  staticQrs: Row[] = [];
  qrClaims: Row[] = [];
  schemes: Row[] = [];
  schemeSlabs: Row[] = [];
  commissionCredits: Row[] = [];

  addUser(
    id: string,
    walletBalance: number | string = 0,
    heldBalance: number | string = 0,
    status: string = "ACTIVE",
    aepsBalance: number | string = 0,
    // Cascade-model fields (role/schemeId/parentId) for the pricing chain.
    opts: { role?: string; schemeId?: string | null; parentId?: string | null } = {}
  ) {
    this.users.set(id, {
      id,
      status,
      walletBalance: decOf(walletBalance),
      heldBalance: decOf(heldBalance),
      aepsBalance: decOf(aepsBalance),
      lienBalance: decOf(0),
      revenueBalance: decOf(0),
      // Left undefined unless set: a role-less fake user is treated as staff
      // by the scheme gate, so legacy tests that don't care about schemes
      // keep working. Cascade tests pass role: "RETAILER" etc. explicitly.
      role: opts.role,
      schemeId: opts.schemeId ?? null,
      parentId: opts.parentId ?? null,
    });
  }

  /** Register a scheme + one FLAT slab, for cascade commission tests. */
  addScheme(
    id: string,
    slab: {
      service: string;
      minAmount?: number;
      maxAmount?: number;
      chargeValue?: number;
      commissionValue?: number;
    }
  ) {
    this.schemes.push({ id, name: id, active: true, isDefault: false });
    this.schemeSlabs.push({
      id: `${id}-slab`,
      schemeId: id,
      service: slab.service,
      minAmount: decOf(slab.minAmount ?? 0),
      maxAmount: decOf(slab.maxAmount ?? 10_000_000),
      chargeType: "FLAT",
      chargeValue: decOf(slab.chargeValue ?? 0),
      commissionType: "FLAT",
      commissionValue: decOf(slab.commissionValue ?? 0),
      parentSlabId: null,
      active: true,
    });
  }

  setUserStatus(id: string, status: string) {
    const row = this.users.get(id);
    if (row) row.status = status;
  }

  balanceOf(id: string): string {
    return decOf(this.users.get(id)?.walletBalance).toFixed(2);
  }

  heldOf(id: string): string {
    return decOf(this.users.get(id)?.heldBalance).toFixed(2);
  }

  aepsBalanceOf(id: string): string {
    return decOf(this.users.get(id)?.aepsBalance).toFixed(2);
  }

  // ── prisma.user ───────────────────────────────────────────────────────────
  user = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.users.get(where.id);
      if (!row) return null;
      // Emulate the `scheme` relation read by the scheme gate (unified model:
      // one scheme carries both service and MDR slabs).
      const scheme = row.schemeId
        ? this.schemes.find((s) => s.id === row.schemeId) ?? null
        : null;
      return { ...row, scheme: scheme ? { ...scheme } : null };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.users.get(where.id);
      if (!row) throw new Error(`FakeDb: user ${where.id} not found`);
      if (data.walletBalance !== undefined) row.walletBalance = decOf(data.walletBalance);
      if (data.heldBalance !== undefined) row.heldBalance = decOf(data.heldBalance);
      if (data.aepsBalance !== undefined) row.aepsBalance = decOf(data.aepsBalance);
      if (data.lienBalance !== undefined) row.lienBalance = decOf(data.lienBalance);
      if (data.revenueBalance !== undefined) row.revenueBalance = decOf(data.revenueBalance);
      return { ...row };
    },
  };

  // ── prisma.walletTxn ──────────────────────────────────────────────────────
  walletTxn = {
    findUnique: async ({ where }: { where: { idempotencyKey: string } }) => {
      const row = this.walletTxns.find((t) => t.idempotencyKey === where.idempotencyKey);
      return row ? { ...row } : null;
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: nextId(), createdAt: new Date(), ...data };
      this.walletTxns.push(row);
      return { ...row };
    },
  };

  // ── prisma.transaction ────────────────────────────────────────────────────
  transaction = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: nextId(), createdAt: new Date(), ...data };
      this.transactions.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.transactions.find((t) => t.id === where.id);
      if (!row) throw new Error(`FakeDb: transaction ${where.id} not found`);
      Object.assign(row, data);
      return { ...row };
    },
    findUnique: async ({ where }: { where: { id?: string; refId?: string } }) => {
      const row = this.transactions.find((t) =>
        where.id !== undefined ? t.id === where.id : t.refId === where.refId
      );
      return row ? { ...row } : null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; status?: { in: string[] } };
      data: Row;
    }) => {
      const rows = this.transactions.filter(
        (t) =>
          (where.id === undefined || t.id === where.id) &&
          (where.status === undefined || where.status.in.includes(t.status as string))
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    aggregate: async () => ({ _sum: { amount: null, fee: null } }),
    count: async () => 0,
  };

  // ── prisma.scheme / schemeSlab / commissionCredit (cascade model) ─────────
  scheme = {
    findFirst: async ({ where }: { where: { id?: string; active?: boolean; isDefault?: boolean } }) => {
      const row = this.schemes.find(
        (s) =>
          (where.id === undefined || s.id === where.id) &&
          (where.active === undefined || s.active === where.active) &&
          (where.isDefault === undefined || s.isDefault === where.isDefault)
      );
      return row ? { ...row } : null;
    },
  };

  schemeSlab = {
    findMany: async ({ where }: { where: { schemeId?: string; service?: string; active?: boolean } }) =>
      this.schemeSlabs
        .filter(
          (s) =>
            (where.schemeId === undefined || s.schemeId === where.schemeId) &&
            (where.service === undefined || s.service === where.service) &&
            (where.active === undefined || s.active === where.active)
        )
        .map((s) => ({ ...s })),
  };

  commissionCredit = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: nextId(), createdAt: new Date(), ...data };
      this.commissionCredits.push(row);
      return { ...row };
    },
  };

  // ── prisma.payoutRequest (risk-engine reads only) ─────────────────────────
  payoutRequest = {
    aggregate: async () => ({ _sum: { totalDebit: null } }),
    count: async () => 0,
    findFirst: async () => null,
  };

  // ── prisma.walletLien — no liens in the legacy money-path tests, so the
  //    eager-recovery sweep is a clean no-op. ─────────────────────────────────
  walletLien = {
    findMany: async () => [] as Row[],
    findUnique: async () => null,
    findUniqueOrThrow: async () => {
      throw new Error("FakeDb: walletLien.findUniqueOrThrow not stubbed");
    },
    create: async ({ data }: { data: Row }) => ({ id: nextId(), createdAt: new Date(), ...data }),
    update: async ({ data }: { where: { id: string }; data: Row }) => ({ ...data }),
    count: async () => 0,
  };

  // ── prisma.platformSetting — no rows in unit tests, so every setting
  //    resolves to its schema default (see src/lib/settings.ts). ─────────────
  platformSetting = {
    findUnique: async () => null,
    findMany: async () => [] as Row[],
  };

  // ── prisma.userLimit — no admin-assigned limits in unit tests, so the
  //    risk engine and wallet-cap hooks fall back to platform defaults. ──────
  userLimit = {
    findUnique: async () => null,
  };

  // ── prisma.webhookEndpoint (Phase 4) — no subscribers in unit tests, so
  //    emitWebhookEvent fan-out is a clean no-op instead of a logged error. ──
  webhookEndpoint = {
    findMany: async () => [] as Row[],
  };

  // ── prisma.staticQr (QR collections) ──────────────────────────────────────
  addStaticQr(id: string, opts?: { active?: boolean; disabledAt?: Date | null }) {
    this.staticQrs.push({
      id,
      label: `QR ${id}`,
      upiVpa: "merchant@upi",
      active: opts?.active ?? true,
      disabledAt: opts?.disabledAt ?? null,
      createdAt: new Date(),
    });
  }

  // ── prisma.serviceRoute — only the read used by railScopeKey() at
  //    settlement. No routes seeded in tests → null → rail-wide floor scope.
  serviceRoute = {
    findFirst: async () => null,
  };

  staticQr = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.staticQrs.find((q) => q.id === where.id);
      return row ? { ...row } : null;
    },
    findFirst: async ({ where }: { where?: { active?: boolean } } = {}) => {
      const row = this.staticQrs.find((q) => where?.active === undefined || q.active === where.active);
      return row ? { ...row } : null;
    },
  };

  // ── prisma.qrClaim (QR collections) — enforces the utr/screenshotHash
  //    unique indexes with a Prisma-style P2002 error. ───────────────────────
  qrClaim = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.qrClaims.find((c) => c.id === where.id);
      return row ? { ...row } : null;
    },
    findFirst: async ({ where }: { where: { utr?: string; screenshotHash?: string } }) => {
      const row = this.qrClaims.find(
        (c) =>
          (where.utr === undefined || c.utr === where.utr) &&
          (where.screenshotHash === undefined || c.screenshotHash === where.screenshotHash)
      );
      return row ? { ...row } : null;
    },
    create: async ({ data }: { data: Row }) => {
      if (this.qrClaims.some((c) => c.utr === data.utr || c.screenshotHash === data.screenshotHash)) {
        const err = new Error("Unique constraint failed") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      const row = { id: nextId(), status: "PENDING", createdAt: new Date(), ...data };
      this.qrClaims.push(row);
      return { ...row };
    },
    findMany: async ({
      where = {},
      take,
      include,
    }: {
      where?: {
        id?: string | { in: string[] };
        userId?: string;
        status?: string | { in: string[] };
        settleableAt?: { lt: Date };
      };
      orderBy?: unknown;
      take?: number;
      include?: { qr?: unknown };
    } = {}) => {
      let rows = this.qrClaims.filter((c) => {
        if (where.id !== undefined) {
          if (typeof where.id === "string") {
            if (c.id !== where.id) return false;
          } else if (!where.id.in.includes(c.id as string)) return false;
        }
        if (where.userId !== undefined && c.userId !== where.userId) return false;
        if (where.status !== undefined) {
          if (typeof where.status === "string") {
            if (c.status !== where.status) return false;
          } else if (!where.status.in.includes(c.status as string)) return false;
        }
        if (where.settleableAt?.lt !== undefined) {
          const at = c.settleableAt as Date | null | undefined;
          if (!at || !(at < where.settleableAt.lt)) return false;
        }
        return true;
      });
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((c) => {
        const out: Row = { ...c };
        if (include?.qr) out.qr = { label: `QR ${c.qrId}` };
        return out;
      });
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; status?: string | { in: string[] } };
      data: Row;
    }) => {
      const statusOk = (s: unknown) =>
        where.status === undefined ||
        (typeof where.status === "string" ? s === where.status : where.status.in.includes(s as string));
      const rows = this.qrClaims.filter(
        (c) => (where.id === undefined || c.id === where.id) && statusOk(c.status)
      );
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    count: async ({ where }: { where?: { userId?: string; createdAt?: { gte: Date } } } = {}) =>
      this.qrClaims.filter(
        (c) =>
          (where?.userId === undefined || c.userId === where.userId) &&
          (where?.createdAt === undefined || (c.createdAt as Date) >= where.createdAt.gte)
      ).length,
    aggregate: async ({
      where,
    }: {
      _sum?: unknown;
      _count?: unknown;
      where?: { userId?: string; createdAt?: { gte: Date }; status?: string; reconciledAt?: null };
    } = {}) => {
      const rows = this.qrClaims.filter(
        (c) =>
          (where?.userId === undefined || c.userId === where.userId) &&
          (where?.createdAt === undefined || (c.createdAt as Date) >= where.createdAt.gte) &&
          (where?.status === undefined || c.status === where.status) &&
          (where?.reconciledAt === undefined || (c.reconciledAt ?? null) === where.reconciledAt)
      );
      const sum = rows.reduce((acc, c) => acc.plus(decOf(c.amount)), new Prisma.Decimal(0));
      return { _sum: { amount: rows.length ? sum : null }, _count: rows.length };
    },
  };

  // ── prisma.auditLog ───────────────────────────────────────────────────────
  auditLog = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: nextId(), createdAt: new Date(), ...data };
      this.auditLogs.push(row);
      return { ...row };
    },
  };

  // ── client-level ──────────────────────────────────────────────────────────
  $queryRaw = async () => [] as unknown[];

  $transaction = async <T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> => {
    // Inline execution: adequate for single-threaded unit tests.
    return fn(this);
  };
}
