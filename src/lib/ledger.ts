import { Prisma, type WalletReason, type WalletTxn, type WalletType } from "@prisma/client";
import { prisma } from "./db";
import { add, sub, gte, gt, lt, dec, type Money } from "./money";
import { getSuspenseAccountId } from "./wallet/suspense";

/**
 * Canonical wallet ledger.
 *
 * Every rupee that moves MUST go through one of these functions. They guarantee:
 *
 *  1. Exact Decimal math (never JS floats).
 *  2. Pessimistic row locking (`SELECT ... FOR UPDATE`) so concurrent operations
 *     on the same wallet cannot race into an overspend.
 *  3. Idempotency — a money movement tagged with an `idempotencyKey` is applied
 *     at most once, even under retries or duplicate webhook deliveries.
 *  4. A `balanceAfter` snapshot on every WalletTxn (powers the Account passbook).
 *
 * Balance model (authorization-hold style):
 *   - walletBalance  = total funds owned by the user
 *   - heldBalance    = funds reserved for in-flight operations (pending payout)
 *   - lienBalance    = outstanding admin lien (chargeback/fraud) debt still owed;
 *                      invisible to the user but frozen from spending
 *   - spendable      = max(0, walletBalance - heldBalance - lienBalance)
 *
 * Holds/releases are *reservations* and do NOT create a WalletTxn (they are not
 * real money movements). The actual DEBIT lands on `captureHold` when the
 * operation is confirmed, so the passbook reflects only settled movements.
 *
 * Liens recover EAGERLY: any PRIMARY credit that lands for a user with an active
 * lien is immediately swept toward the Company Suspense account (see
 * `sweepLiensForUser`), so recovered money never becomes spendable.
 */

export type LedgerErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_HOLD"
  | "INVALID_AMOUNT";

export class LedgerError extends Error {
  constructor(public code: LedgerErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LedgerError";
  }
}

type Tx = Prisma.TransactionClient;

/** Run `fn` inside the provided transaction, or open a fresh one. */
async function withTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (tx) return fn(tx);
  return prisma.$transaction((t) => fn(t));
}

/**
 * Lock a user row for the remainder of the transaction and return fresh
 * balances. Must be called inside a transaction.
 */
async function lockUser(tx: Tx, userId: string) {
  // FOR UPDATE serializes concurrent writers on this row.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      walletBalance: true,
      heldBalance: true,
      lienBalance: true,
      aepsBalance: true,
      revenueBalance: true,
      payinBalance: true,
    },
  });
  if (!user) throw new LedgerError("INVALID_AMOUNT", "User not found");
  return user;
}

/**
 * Spendable balance on the PRIMARY book: total minus in-flight holds minus the
 * outstanding lien, floored at zero so a lien larger than the balance can never
 * produce a negative spendable.
 */
function primarySpendable(user: {
  walletBalance: Money;
  heldBalance: Money;
  lienBalance?: Money | null;
}): Money {
  const lien = user.lienBalance ?? dec(0);
  const s = sub(sub(user.walletBalance, user.heldBalance), lien);
  return gt(s, 0) ? s : dec(0);
}

/** The balance column backing a wallet book. */
function bookBalance(
  user: { walletBalance: Money; aepsBalance: Money; revenueBalance: Money; payinBalance: Money },
  walletType: WalletType
): Money {
  if (walletType === "AEPS") return user.aepsBalance;
  if (walletType === "REVENUE") return user.revenueBalance;
  if (walletType === "PAYIN") return user.payinBalance;
  return user.walletBalance;
}

/** The Prisma update payload that writes a wallet book's new balance. */
function bookUpdate(walletType: WalletType, newBalance: Money) {
  if (walletType === "AEPS") return { aepsBalance: newBalance };
  if (walletType === "REVENUE") return { revenueBalance: newBalance };
  if (walletType === "PAYIN") return { payinBalance: newBalance };
  return { walletBalance: newBalance };
}

function assertPositive(amount: Money | string | number) {
  if (!dec(amount).gt(0)) throw new LedgerError("INVALID_AMOUNT", "Amount must be > 0");
}

/** If a WalletTxn with this idempotency key already exists, return it. */
async function findByIdempotencyKey(tx: Tx, key: string): Promise<WalletTxn | null> {
  return tx.walletTxn.findUnique({ where: { idempotencyKey: key } });
}

export type WalletMovement = {
  userId: string;
  amount: Money | string | number;
  reason: WalletReason;
  refType?: string;
  refId?: string;
  note?: string;
  /** Strongly recommended for any retryable / externally-triggered movement. */
  idempotencyKey?: string;
  /**
   * Which wallet book to move money in. PRIMARY (default) = the spendable
   * wallet; AEPS = the secondary AEPS-proceeds wallet. Holds only exist on
   * the PRIMARY book.
   */
  walletType?: WalletType;
};

/**
 * Credit (add) funds to a user's wallet (PRIMARY / AEPS / REVENUE book).
 *
 * If the credit lands on the PRIMARY book and the user has an active lien, the
 * newly-credited funds are immediately swept toward recovery (see
 * `sweepLiensForUser`) inside the same transaction — so money owed under a lien
 * never becomes spendable, no matter which rail credited it.
 */
export async function creditWallet(m: WalletMovement, tx?: Tx): Promise<WalletTxn> {
  assertPositive(m.amount);
  const walletType: WalletType = m.walletType ?? "PRIMARY";
  return withTx(tx, async (t) => {
    if (m.idempotencyKey) {
      const existing = await findByIdempotencyKey(t, m.idempotencyKey);
      if (existing) return existing; // already applied — do not re-sweep
    }
    const user = await lockUser(t, m.userId);
    const current = bookBalance(user, walletType);
    const newBalance = add(current, m.amount);
    await t.user.update({
      where: { id: m.userId },
      data: bookUpdate(walletType, newBalance),
    });
    const txn = await t.walletTxn.create({
      data: {
        userId: m.userId,
        walletType,
        direction: "CREDIT",
        reason: m.reason,
        amount: new Prisma.Decimal(dec(m.amount)),
        balanceAfter: new Prisma.Decimal(newBalance),
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        idempotencyKey: m.idempotencyKey,
      },
    });
    // Eager lien recovery — only the PRIMARY book carries liens. Guarded so the
    // suspense account's own recovery credit never recurses back into a sweep.
    if (walletType === "PRIMARY" && user.lienBalance && gt(user.lienBalance, 0)) {
      await sweepLiensForUser(t, m.userId);
    }
    return txn;
  });
}

/** Debit (remove) funds from a user's spendable balance (PRIMARY or AEPS book). */
export async function debitWallet(m: WalletMovement, tx?: Tx): Promise<WalletTxn> {
  assertPositive(m.amount);
  const walletType: WalletType = m.walletType ?? "PRIMARY";
  return withTx(tx, async (t) => {
    if (m.idempotencyKey) {
      const existing = await findByIdempotencyKey(t, m.idempotencyKey);
      if (existing) return existing;
    }
    const user = await lockUser(t, m.userId);
    // Only the PRIMARY book has holds/liens; AEPS/REVENUE books are fully spendable.
    const spendable =
      walletType === "PRIMARY" ? primarySpendable(user) : bookBalance(user, walletType);
    if (!gte(spendable, m.amount)) {
      throw new LedgerError("INSUFFICIENT_FUNDS");
    }
    const current = bookBalance(user, walletType);
    const newBalance = sub(current, m.amount);
    await t.user.update({
      where: { id: m.userId },
      data: bookUpdate(walletType, newBalance),
    });
    return t.walletTxn.create({
      data: {
        userId: m.userId,
        walletType,
        direction: "DEBIT",
        reason: m.reason,
        amount: new Prisma.Decimal(dec(m.amount)),
        balanceAfter: new Prisma.Decimal(newBalance),
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        idempotencyKey: m.idempotencyKey,
      },
    });
  });
}

export type HoldInput = {
  userId: string;
  amount: Money | string | number;
};

/**
 * Reserve funds from spendable balance (authorization hold). Does not create a
 * WalletTxn. Idempotency is the caller's responsibility — call this exactly once
 * inside the same transaction that transitions the owning entity (e.g. a
 * PayoutRequest) into its "held" state.
 */
export async function holdFunds(m: HoldInput, tx?: Tx): Promise<{ heldBalance: Money }> {
  assertPositive(m.amount);
  return withTx(tx, async (t) => {
    const user = await lockUser(t, m.userId);
    const spendable = primarySpendable(user);
    if (!gte(spendable, m.amount)) {
      throw new LedgerError("INSUFFICIENT_FUNDS");
    }
    const newHeld = add(user.heldBalance, m.amount);
    await t.user.update({
      where: { id: m.userId },
      data: { heldBalance: newHeld },
    });
    return { heldBalance: newHeld };
  });
}

/** Release a previously-held reservation back to spendable (e.g. payout failed). */
export async function releaseHold(m: HoldInput, tx?: Tx): Promise<{ heldBalance: Money }> {
  assertPositive(m.amount);
  return withTx(tx, async (t) => {
    const user = await lockUser(t, m.userId);
    if (!gte(user.heldBalance, m.amount)) {
      throw new LedgerError("INSUFFICIENT_HOLD");
    }
    const newHeld = sub(user.heldBalance, m.amount);
    await t.user.update({
      where: { id: m.userId },
      data: { heldBalance: newHeld },
    });
    return { heldBalance: newHeld };
  });
}

/**
 * Finalize a hold into a real debit (e.g. payout confirmed by BulkPe). Reduces
 * both heldBalance and walletBalance and writes the settling WalletTxn. This is
 * the entry that appears in the user's passbook.
 */
export async function captureHold(m: WalletMovement, tx?: Tx): Promise<WalletTxn> {
  assertPositive(m.amount);
  return withTx(tx, async (t) => {
    if (m.idempotencyKey) {
      const existing = await findByIdempotencyKey(t, m.idempotencyKey);
      if (existing) return existing;
    }
    const user = await lockUser(t, m.userId);
    if (!gte(user.heldBalance, m.amount)) {
      throw new LedgerError("INSUFFICIENT_HOLD");
    }
    const newBalance = sub(user.walletBalance, m.amount);
    const newHeld = sub(user.heldBalance, m.amount);
    await t.user.update({
      where: { id: m.userId },
      data: { walletBalance: newBalance, heldBalance: newHeld },
    });
    return t.walletTxn.create({
      data: {
        userId: m.userId,
        direction: "DEBIT",
        reason: m.reason,
        amount: new Prisma.Decimal(dec(m.amount)),
        balanceAfter: new Prisma.Decimal(newBalance),
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        idempotencyKey: m.idempotencyKey,
      },
    });
  });
}

/**
 * Eagerly recover a user's active liens from their currently-available funds
 * (walletBalance − heldBalance), oldest lien first. Each swept rupee moves via
 * real double-entry: a user PRIMARY DEBIT (reason LIEN, note "Recovery against
 * txn #…") and a matching CREDIT into the Company Suspense account. Recovered
 * amounts reduce both the user's walletBalance and their lienBalance in lock-step
 * (so spendable is unaffected — the money was never spendable), and a lien that
 * reaches its full amount is closed (status RECOVERED).
 *
 * MUST be called inside a transaction. Held funds are never touched. Safe to run
 * repeatedly — it only ever moves outstanding, currently-available money.
 */
export async function sweepLiensForUser(tx: Tx, userId: string): Promise<void> {
  const suspenseId = await getSuspenseAccountId();
  if (suspenseId === userId) return; // never sweep the suspense account itself

  const liens = await tx.walletLien.findMany({
    where: { targetUserId: userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (liens.length === 0) return;

  const user = await lockUser(tx, userId);
  let available: Money = sub(user.walletBalance, user.heldBalance);
  if (!gt(available, 0)) return;

  let userBalance = user.walletBalance as Money;
  let lienBalance = user.lienBalance as Money;
  let suspenseBalance: Money = dec(0);
  let suspenseLocked = false;
  let moved = false;

  for (const lien of liens) {
    const outstanding = sub(lien.amount, lien.recoveredAmount);
    if (!gt(outstanding, 0)) continue;
    const s = lt(outstanding, available) ? outstanding : available; // min(outstanding, available)
    if (!gt(s, 0)) break;

    if (!suspenseLocked) {
      const suspense = await lockUser(tx, suspenseId);
      suspenseBalance = suspense.walletBalance as Money;
      suspenseLocked = true;
    }

    userBalance = sub(userBalance, s);
    lienBalance = sub(lienBalance, s);
    suspenseBalance = add(suspenseBalance, s);
    const newRecovered = add(lien.recoveredAmount, s);
    const fullyRecovered = gte(newRecovered, lien.amount);
    const noteRef = lien.refType === "Transaction" && lien.refId ? lien.refId : lien.id;

    await tx.walletTxn.create({
      data: {
        userId,
        walletType: "PRIMARY",
        direction: "DEBIT",
        reason: "LIEN",
        amount: new Prisma.Decimal(s),
        balanceAfter: new Prisma.Decimal(userBalance),
        refType: "WalletLien",
        refId: lien.id,
        note: `Recovery against txn #${noteRef}`,
      },
    });
    await tx.walletTxn.create({
      data: {
        userId: suspenseId,
        walletType: "PRIMARY",
        direction: "CREDIT",
        reason: "LIEN",
        amount: new Prisma.Decimal(s),
        balanceAfter: new Prisma.Decimal(suspenseBalance),
        refType: "WalletLien",
        refId: lien.id,
        note: `Lien recovery from ${userId} (txn #${noteRef})`,
      },
    });
    await tx.walletLien.update({
      where: { id: lien.id },
      data: {
        recoveredAmount: new Prisma.Decimal(newRecovered),
        ...(fullyRecovered ? { status: "RECOVERED", closedAt: new Date() } : {}),
      },
    });

    moved = true;
    available = sub(available, s);
    if (!gt(available, 0)) break;
  }

  if (!moved) return;
  await tx.user.update({
    where: { id: userId },
    data: { walletBalance: userBalance, lienBalance },
  });
  await tx.user.update({
    where: { id: suspenseId },
    data: { walletBalance: suspenseBalance },
  });
}

/**
 * Place a lien hold of `amount` on a user (adds to lienBalance → reduces
 * spendable) and immediately sweep whatever is currently available toward it.
 * The caller MUST have created the ACTIVE WalletLien row first, in the same
 * transaction, so the sweep can see it. MUST run inside a transaction.
 */
export async function placeLienHold(userId: string, amount: Money | string | number, tx: Tx): Promise<void> {
  assertPositive(amount);
  const user = await lockUser(tx, userId);
  await tx.user.update({
    where: { id: userId },
    data: { lienBalance: add(user.lienBalance, amount) },
  });
  await sweepLiensForUser(tx, userId);
}

/**
 * Release a lien's still-outstanding portion back to the user's spendable
 * balance (no money moves — already-recovered funds stay with the company).
 * MUST run inside a transaction.
 */
export async function releaseLienHold(userId: string, remaining: Money | string | number, tx: Tx): Promise<void> {
  const user = await lockUser(tx, userId);
  const next = sub(user.lienBalance, remaining);
  await tx.user.update({
    where: { id: userId },
    data: { lienBalance: gt(next, 0) ? next : dec(0) },
  });
}

/** Read-only snapshot of a user's balances. */
export async function getBalances(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      walletBalance: true,
      heldBalance: true,
      lienBalance: true,
      aepsBalance: true,
      revenueBalance: true,
      payinBalance: true,
    },
  });
  if (!user) throw new LedgerError("INVALID_AMOUNT", "User not found");
  return {
    walletBalance: user.walletBalance as Money,
    heldBalance: user.heldBalance as Money,
    lienBalance: user.lienBalance as Money,
    aepsBalance: user.aepsBalance as Money,
    revenueBalance: user.revenueBalance as Money,
    payinBalance: user.payinBalance as Money,
    spendable: primarySpendable(user),
  };
}
