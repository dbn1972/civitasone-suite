import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  feeSchedules, feePayments, feeRefunds, feeReceiptCounters,
  type FeeScheduleRow, type FeeScheduleInsert,
  type PaymentRow, type PaymentInsert, type RefundRow, type RefundInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertSchedule(tx: Writer, row: FeeScheduleInsert): Promise<void> {
  await tx.insert(feeSchedules).values(row);
}

export async function findScheduleByIdTx(tx: Writer, id: string, tenantId: string): Promise<FeeScheduleRow | null> {
  const rows = await (tx as typeof db).select().from(feeSchedules)
    .where(and(eq(feeSchedules.id, id), eq(feeSchedules.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findActiveScheduleForService(tx: Writer, tenantId: string, serviceId: string): Promise<FeeScheduleRow | null> {
  const rows = await (tx as typeof db).select().from(feeSchedules)
    .where(and(eq(feeSchedules.tenantId, tenantId), eq(feeSchedules.serviceId, serviceId), eq(feeSchedules.active, true)))
    .orderBy(desc(feeSchedules.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function listSchedules(tenantId: string, limit = 200): Promise<FeeScheduleRow[]> {
  return db.transaction((tx) => tx.select().from(feeSchedules)
    .where(eq(feeSchedules.tenantId, tenantId)).orderBy(desc(feeSchedules.createdAt)).limit(limit));
}

export async function insertPayment(tx: Writer, row: PaymentInsert): Promise<void> {
  await tx.insert(feePayments).values(row);
}

export async function findPaymentByIdTx(tx: Writer, id: string, tenantId: string): Promise<PaymentRow | null> {
  const rows = await (tx as typeof db).select().from(feePayments)
    .where(and(eq(feePayments.id, id), eq(feePayments.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findPaymentById(id: string, tenantId: string): Promise<PaymentRow | null> {
  return db.transaction((tx) => findPaymentByIdTx(tx, id, tenantId));
}

export async function updatePayment(tx: Writer, id: string, tenantId: string, patch: Partial<PaymentInsert>): Promise<void> {
  await tx.update(feePayments).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(feePayments.id, id), eq(feePayments.tenantId, tenantId)));
}

export async function listPaymentsByApplication(tenantId: string, applicationId: string, limit = 200): Promise<PaymentRow[]> {
  return db.transaction((tx) => tx.select().from(feePayments)
    .where(and(eq(feePayments.tenantId, tenantId), eq(feePayments.applicationId, applicationId)))
    .orderBy(desc(feePayments.createdAt)).limit(limit));
}

/**
 * Atomically reserve the next receipt sequence for (tenant, year). The
 * INSERT..ON CONFLICT DO UPDATE..RETURNING is race-free — concurrent offline
 * collections serialize on the counter PK and receive consecutive numbers,
 * replacing the racy SELECT count(*)+1 (which allotted duplicate receipt nos
 * under concurrency). Mirrors issuance.nextSequence.
 */
export async function nextReceiptSeq(tx: Writer, tenantId: string, year: number): Promise<number> {
  const rows = await (tx as typeof db).insert(feeReceiptCounters)
    .values({ tenantId, year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [feeReceiptCounters.tenantId, feeReceiptCounters.year],
      set: { lastSeq: sql`${feeReceiptCounters.lastSeq} + 1`, updatedAt: new Date() },
    })
    .returning({ lastSeq: feeReceiptCounters.lastSeq });
  return rows[0]!.lastSeq;
}

export async function insertRefund(tx: Writer, row: RefundInsert): Promise<void> {
  await tx.insert(feeRefunds).values(row);
}

export async function findRefundByIdTx(tx: Writer, id: string, tenantId: string): Promise<RefundRow | null> {
  const rows = await (tx as typeof db).select().from(feeRefunds)
    .where(and(eq(feeRefunds.id, id), eq(feeRefunds.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function updateRefund(tx: Writer, id: string, tenantId: string, patch: Partial<RefundInsert>): Promise<void> {
  await tx.update(feeRefunds).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(feeRefunds.id, id), eq(feeRefunds.tenantId, tenantId)));
}

export async function listRefundsByPayment(tenantId: string, paymentId: string): Promise<RefundRow[]> {
  return db.transaction((tx) => tx.select().from(feeRefunds)
    .where(and(eq(feeRefunds.tenantId, tenantId), eq(feeRefunds.paymentId, paymentId)))
    .orderBy(desc(feeRefunds.createdAt)));
}
