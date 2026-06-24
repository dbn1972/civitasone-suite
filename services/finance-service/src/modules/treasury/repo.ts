import { eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  financeBanks, financeChallans, financeDeposits, financeDepositEvents,
  type BankRow, type ChallanInsert, type DepositInsert, type DepositRow, type DepositEventInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
/** Executor surface for raw guarded SQL (FOR UPDATE / conditional UPDATE). */
type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export async function findBankById(id: string): Promise<BankRow | null> {
  const rows = await db.select().from(financeBanks).where(eq(financeBanks.id, id)).limit(1);
  return rows[0] ?? null;
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
 * Status flips to 'closed' exactly when the new balance reaches 0. No read-then-set.
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
  const amt = amount.toString();
  const res = await (tx as unknown as Executor).execute(sql`
    UPDATE treasury.finance_deposits
       SET balance_minor = balance_minor - ${amt}::bigint,
           ${totalCol} = ${totalCol} + ${amt}::bigint,
           status = CASE WHEN balance_minor - ${amt}::bigint = 0 THEN 'closed' ELSE 'active' END,
           updated_by = ${actorId}::uuid,
           updated_at = now(),
           version = version + 1
     WHERE id = ${id}::uuid
       AND balance_minor >= ${amt}::bigint
  `);
  const count = (res as { rowCount?: number }).rowCount
    ?? ((res as { rows?: unknown[] }).rows?.length ?? 0);
  return count > 0;
}
