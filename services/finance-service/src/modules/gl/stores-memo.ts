/**
 * UAT L2-N6 review: gl.stores_valuation_memo (migration 0160) -- finance record of every inventory-service stock
 * movement. Cash basis: the whole record (no journal). Accrual: also the journal it posted; read by GRNI clearing.
 * Insert is ON CONFLICT DO NOTHING on (tenant_id, movement_id): a redelivery records nothing twice.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { pgSchema, uuid, varchar, bigint, date, timestamp, primaryKey } from "drizzle-orm/pg-core";
import type { StoresMovement } from "./inventory-movement.js";

const glSchema = pgSchema("gl");

export const storesValuationMemo = glSchema.table("stores_valuation_memo", {
  tenantId:    uuid("tenant_id").notNull(),
  movementId:  uuid("movement_id").notNull(),
  kind:        varchar("kind", { length: 16 }).notNull(),
  totalMinor:  bigint("total_minor", { mode: "bigint" }).notNull(),
  postingDate: date("posting_date").notNull(),
  storeId:     uuid("store_id"),
  refDoc:      varchar("ref_doc", { length: 64 }),
  refNo:       varchar("ref_no", { length: 64 }),
  basis:       varchar("basis", { length: 8 }).notNull(),
  journalId:   uuid("journal_id"),
  createdBy:   uuid("created_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.movementId] }) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/** Record the movement; false when it was already recorded (redelivery). */
export async function recordStoresMovementTx(
  tx: Tx, tenantId: string, m: StoresMovement, basis: "cash" | "accrual", journalId: string | null, actorId: string,
): Promise<boolean> {
  const rows = await tx.insert(storesValuationMemo).values({
    tenantId, movementId: m.movementId, kind: m.kind, totalMinor: BigInt(m.totalMinor), postingDate: m.postingDate,
    storeId: m.storeId, refDoc: m.refDoc, refNo: m.refNo, basis, journalId, createdBy: actorId,
  }).onConflictDoNothing().returning({ id: storesValuationMemo.movementId });
  return rows.length > 0;
}

/** Accrual GRN receipts of one GRN that posted a journal: total paise and the latest posting date. */
export async function grnReceiptTotalTx(tx: Tx, tenantId: string, grnId: string): Promise<{ totalMinor: bigint; postingDate: string | null }> {
  const rows = await tx.select({
    total: sql<string>`coalesce(sum(${storesValuationMemo.totalMinor}), 0)::text`,
    last: sql<string | null>`max(${storesValuationMemo.postingDate})::text`,
  }).from(storesValuationMemo).where(and(
    eq(storesValuationMemo.tenantId, tenantId), eq(storesValuationMemo.kind, "receipt"),
    eq(storesValuationMemo.refDoc, "GRN"), eq(storesValuationMemo.refNo, grnId),
    eq(storesValuationMemo.basis, "accrual"), isNotNull(storesValuationMemo.journalId),
  ));
  return { totalMinor: BigInt(rows[0]?.total ?? "0"), postingDate: rows[0]?.last ?? null };
}
