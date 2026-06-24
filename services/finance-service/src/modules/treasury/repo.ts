import { eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  financeBanks, financeChallans, financeDeposits, financeDepositEvents,
  type BankRow, type ChallanInsert, type DepositInsert, type DepositRow, type DepositEventInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

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

export async function insertDepositEvent(tx: Writer, row: DepositEventInsert): Promise<void> {
  // Idempotent on (tenant, deposit, event_type, reference) — a redelivered
  // disposition command does not double-record.
  await (tx as typeof db).insert(financeDepositEvents).values(row).onConflictDoNothing();
}

/**
 * Apply a disposition (refund | forfeit | adjust) to a deposit: increment the
 * matching running total, set the new held balance, and close the deposit when
 * fully disposed. Pure SQL expression update (no read-then-set).
 */
export async function applyDepositDisposition(
  tx: Writer,
  id: string,
  event: "refund" | "forfeit" | "adjust",
  amount: bigint,
  newBalance: bigint,
  actorId: string,
): Promise<void> {
  const col =
    event === "refund" ? financeDeposits.refundedMinor
    : event === "forfeit" ? financeDeposits.forfeitedMinor
    : financeDeposits.adjustedMinor;
  await (tx as typeof db).update(financeDeposits).set({
    [event === "refund" ? "refundedMinor" : event === "forfeit" ? "forfeitedMinor" : "adjustedMinor"]:
      sql`${col} + ${amount.toString()}::bigint`,
    balanceMinor: newBalance,
    status: newBalance === 0n ? "closed" : "active",
    updatedBy: actorId,
    updatedAt: new Date(),
    version: sql`${financeDeposits.version} + 1`,
  }).where(eq(financeDeposits.id, id));
}
