import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  financeBanks, financeChallans, financeDeposits, financeDepositEvents, financeDebt, financeGuarantees,
  type BankRow, type ChallanInsert, type ChallanRow, type DepositInsert, type DepositRow, type DepositEventInsert,
  type DebtRow, type GuaranteeRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
/** Executor surface for raw guarded SQL (FOR UPDATE / conditional UPDATE). */
type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export async function findBankById(id: string): Promise<BankRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeBanks).where(eq(financeBanks.id, id)).limit(1));
  return rows[0] ?? null;
}

// ── C-series reads: debt / guarantees / challans register / deposits register ──

export async function listDebtByTenant(tenantId: string, limit: number, offset = 0): Promise<DebtRow[]> {
  return scopedRead((tx) => tx.select().from(financeDebt)
    .where(eq(financeDebt.tenantId, tenantId))
    .orderBy(desc(financeDebt.createdAt))
    .limit(limit)
    .offset(offset));
}

export async function listGuaranteesByTenant(tenantId: string, limit: number, offset = 0): Promise<GuaranteeRow[]> {
  return scopedRead((tx) => tx.select().from(financeGuarantees)
    .where(eq(financeGuarantees.tenantId, tenantId))
    .orderBy(desc(financeGuarantees.createdAt))
    .limit(limit)
    .offset(offset));
}

export async function listChallansByTenant(tenantId: string, limit: number, offset = 0): Promise<ChallanRow[]> {
  return scopedRead((tx) => tx.select().from(financeChallans)
    .where(eq(financeChallans.tenantId, tenantId))
    .orderBy(desc(financeChallans.createdAt))
    .limit(limit)
    .offset(offset));
}

export async function findChallanByIdAndTenant(id: string, tenantId: string): Promise<ChallanRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeChallans)
    .where(and(eq(financeChallans.id, id), eq(financeChallans.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listDepositsByTenant(tenantId: string, limit: number, offset = 0): Promise<DepositRow[]> {
  return scopedRead((tx) => tx.select().from(financeDeposits)
    .where(eq(financeDeposits.tenantId, tenantId))
    .orderBy(desc(financeDeposits.createdAt))
    .limit(limit)
    .offset(offset));
}

export async function insertChallan(tx: Writer, row: ChallanInsert): Promise<void> {
  await tx.insert(financeChallans).values(row);
}

export async function insertDeposit(tx: Writer, row: DepositInsert): Promise<void> {
  await tx.insert(financeDeposits).values(row);
}

export async function findDepositByIdTx(tx: Writer, id: string): Promise<DepositRow | null> {
  const rows = await (tx as typeof db).select().from(financeDeposits).where(eq(financeDeposits.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * C2: read the deposit row under a FOR UPDATE row lock so concurrent
 * refund/forfeit/adjust transactions serialise on this row. The caller must run
 * inside a transaction. Returns null when the deposit does not exist.
 */
export async function findDepositByIdForUpdateTx(tx: Writer, id: string): Promise<DepositRow | null> {
  const res = await (tx as unknown as Executor).execute(sql`
    SELECT * FROM treasury.finance_deposits WHERE id = ${id}::uuid FOR UPDATE
  `);
  const rows = (res as { rows?: unknown[] }).rows ?? (res as unknown[]);
  const arr = rows as Array<Record<string, unknown>>;
  if (!arr[0]) return null;
  const r = arr[0];
  // Map snake_case raw columns onto the drizzle DepositRow shape used by callers.
  return {
    id: r.id, tenantId: r.tenant_id, pdNo: r.pd_no, type: r.type,
    administrator: r.administrator, balanceMinor: BigInt(r.balance_minor as string),
    refundedMinor: BigInt((r.refunded_minor as string) ?? "0"),
    forfeitedMinor: BigInt((r.forfeited_minor as string) ?? "0"),
    adjustedMinor: BigInt((r.adjusted_minor as string) ?? "0"),
    currency: r.currency, status: r.status, sourceBillId: r.source_bill_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: r.created_by, updatedBy: r.updated_by, version: r.version,
  } as unknown as DepositRow;
}

export async function insertDepositEvent(tx: Writer, row: DepositEventInsert): Promise<void> {
  // Idempotent on (tenant, deposit, event_type, reference) — a redelivered
  // disposition command does not double-record.
  await (tx as typeof db).insert(financeDepositEvents).values(row).onConflictDoNothing();
}

/**
 * C2: apply a disposition (refund | forfeit | adjust) atomically with a balance
 * guard. The balance is decremented in-SQL ONLY when it currently holds at least
 * `amount` (balance_minor >= amount), so two concurrent dispositions of the same
 * held money cannot both succeed — the loser updates 0 rows and we return false.
 * Status flips to a terminal value exactly when the new balance reaches 0: a
 * fully-drained refund lands on 'refunded', a fully-drained forfeit lands on
 * 'forfeited' — the only two terminal values treasury.finance_deposits'
 * status CHECK constraint (migration 0036) actually allows besides 'active'.
 * 'adjust' (deposit applied against a bill/payable) has no legal terminal
 * value in that constraint, so a fully-adjusted deposit stays 'active' —
 * that under-represents a fully-resolved adjustment, but is the honest
 * choice given the schema: mapping it onto 'refunded'/'forfeited' would
 * misclassify it in any report keyed off status. No read-then-set.
 * Returns true when the row was updated, false when the guard rejected it.
 */
export async function applyDepositDispositionGuarded(
  tx: Writer,
  id: string,
  event: "refund" | "forfeit" | "adjust",
  amount: bigint,
  actorId: string,
): Promise<boolean> {
  const totalCol =
    event === "refund" ? sql`refunded_minor` :
    event === "forfeit" ? sql`forfeited_minor` :
    sql`adjusted_minor`;
  // Terminal status when this disposition drains the balance to exactly 0 —
  // see the doc comment above for why 'adjust' has no dedicated value.
  const drainedStatus =
    event === "refund" ? "refunded" :
    event === "forfeit" ? "forfeited" :
    "active";
  const amt = amount.toString();
  const res = await (tx as unknown as Executor).execute(sql`
    UPDATE treasury.finance_deposits
       SET balance_minor = balance_minor - ${amt}::bigint,
           ${totalCol} = ${totalCol} + ${amt}::bigint,
           status = CASE WHEN balance_minor - ${amt}::bigint = 0 THEN ${drainedStatus} ELSE 'active' END,
           updated_by = ${actorId}::uuid,
           updated_at = now(),
           version = version + 1
     WHERE id = ${id}::uuid
       AND balance_minor >= ${amt}::bigint
  `);
  // postgres-js (porsager) — the driver drizzle's postgres-js dialect wraps,
  // and the only Postgres driver used here — reports the affected-row count
  // as `.count`, NEVER `.rowCount` (that property belongs to node-postgres
  // /`pg`, a different, unused driver). Verified directly against this
  // driver's shipped types (ResultMeta.count) and runtime source
  // (connection.js parses it from the CommandComplete tag). `.rowCount` is
  // always undefined here, so the old bare `res.rowCount` read always fell
  // through to a broken `res.rows?.length` fallback (this driver's result
  // has no `.rows` sub-property either — it IS the row array) and evaluated
  // to 0 every time: the guard always looked rejected and EVERY disposition,
  // including fully legitimate ones, failed with DEPOSIT_OVERDRAW. Same
  // defensive `.rowCount ?? .count` shape already used in hrms-service (see
  // e.g. recruitment/offer-repo.ts — "PR #254"); kept here for consistency
  // even though `.rowCount` will never actually be present on this driver.
  const count = (res as { rowCount?: number; count?: number }).rowCount
    ?? (res as { count?: number }).count
    ?? 0;
  return count > 0;
}
