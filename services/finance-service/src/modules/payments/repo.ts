import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeBills, financePayments, type BillRow, type BillInsert, type PaymentRow, type PaymentInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findBillById(id: string): Promise<BillRow | null> {
  const rows = await db.select().from(financeBills).where(eq(financeBills.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findBillByIdTx(tx: Writer, id: string): Promise<BillRow | null> {
  const rows = await (tx as typeof db).select().from(financeBills).where(eq(financeBills.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findPaymentById(id: string): Promise<PaymentRow | null> {
  const rows = await db.select().from(financePayments).where(eq(financePayments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertBill(tx: Writer, row: BillInsert): Promise<void> {
  await tx.insert(financeBills).values(row);
}

export async function updateBill(tx: Writer, id: string, patch: Partial<BillInsert>): Promise<void> {
  await tx.update(financeBills).set({ ...patch, updatedAt: new Date() }).where(eq(financeBills.id, id));
}

export async function listPaymentsByTenant(tenantId: string, limit: number, offset: number): Promise<PaymentRow[]> {
  return db.select().from(financePayments)
    .where(eq(financePayments.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
}

export async function insertPayment(tx: Writer, row: PaymentInsert): Promise<void> {
  await tx.insert(financePayments).values(row);
}
