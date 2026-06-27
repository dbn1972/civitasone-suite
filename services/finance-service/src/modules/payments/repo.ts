import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeBills, financePayments, financeAdvances, financeUC, type BillRow, type BillInsert, type PaymentRow, type PaymentInsert, type AdvanceRow, type AdvanceInsert, type UCRow, type UCInsert } from "./schema.js";

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

export async function listBillsByTenant(tenantId: string, limit: number): Promise<BillRow[]> {
  return db.select().from(financeBills)
    .where(eq(financeBills.tenantId, tenantId))
    .limit(limit);
}

export async function insertPayment(tx: Writer, row: PaymentInsert): Promise<void> {
  await tx.insert(financePayments).values(row);
}

export async function listAdvancesByTenant(tenantId: string, limit: number): Promise<AdvanceRow[]> {
  return db.select().from(financeAdvances)
    .where(eq(financeAdvances.tenantId, tenantId))
    .limit(limit);
}

export async function insertAdvance(tx: Writer, row: AdvanceInsert): Promise<void> {
  await tx.insert(financeAdvances).values(row);
}

export async function findAdvanceByIdTx(tx: Writer, id: string): Promise<AdvanceRow | null> {
  const rows = await (tx as typeof db).select().from(financeAdvances).where(eq(financeAdvances.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateAdvance(tx: Writer, id: string, patch: Partial<AdvanceInsert>): Promise<void> {
  await tx.update(financeAdvances).set({ ...patch, updatedAt: new Date() }).where(eq(financeAdvances.id, id));
}

export async function listUCsByTenant(tenantId: string, limit: number): Promise<UCRow[]> {
  return db.select().from(financeUC)
    .where(eq(financeUC.tenantId, tenantId))
    .limit(limit);
}

export async function insertUC(tx: Writer, row: UCInsert): Promise<void> {
  await tx.insert(financeUC).values(row);
}

export async function findUCByIdTx(tx: Writer, id: string): Promise<UCRow | null> {
  const rows = await (tx as typeof db).select().from(financeUC).where(eq(financeUC.id, id)).limit(1);
  return rows[0] ?? null;
}
