import { eq, and, sum } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantInstallments, grantDisbursements, grantPfmsRecords, type InstallmentRow, type InstallmentInsert, type DisbursementRow, type DisbursementInsert, type PfmsRecordInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findInstallmentById(id: string): Promise<InstallmentRow | null> {
  const rows = await db.select().from(grantInstallments).where(eq(grantInstallments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findInstallmentByIdTx(tx: Writer, id: string): Promise<InstallmentRow | null> {
  const rows = await (tx as typeof db).select().from(grantInstallments).where(eq(grantInstallments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findInstallmentsByApplication(applicationId: string): Promise<InstallmentRow[]> {
  return db.select().from(grantInstallments).where(eq(grantInstallments.applicationId, applicationId));
}

export async function findDisbursementsByApplicationId(applicationId: string): Promise<DisbursementRow[]> {
  const installments = await findInstallmentsByApplication(applicationId);
  if (!installments.length) return [];
  const ids = installments.map((i) => i.id);
  const all: DisbursementRow[] = [];
  for (const id of ids) {
    const rows = await db.select().from(grantDisbursements).where(eq(grantDisbursements.installmentId, id));
    all.push(...rows);
  }
  return all;
}

export async function sumDisbursedForApplication(tx: Writer, applicationId: string): Promise<bigint> {
  const installments = await (tx as typeof db).select().from(grantInstallments)
    .where(and(eq(grantInstallments.applicationId, applicationId), eq(grantInstallments.status, "disbursed")));
  return installments.reduce((acc, i) => acc + i.amountMinor, 0n);
}

export async function insertInstallment(tx: Writer, row: InstallmentInsert): Promise<void> {
  await tx.insert(grantInstallments).values(row);
}

export async function updateInstallment(tx: Writer, id: string, patch: Partial<InstallmentInsert>): Promise<void> {
  await tx.update(grantInstallments).set({ ...patch, updatedAt: new Date() }).where(eq(grantInstallments.id, id));
}

export async function insertDisbursement(tx: Writer, row: DisbursementInsert): Promise<void> {
  await tx.insert(grantDisbursements).values(row);
}

export async function updateDisbursement(tx: Writer, id: string, patch: Partial<DisbursementInsert>): Promise<void> {
  await tx.update(grantDisbursements).set({ ...patch, updatedAt: new Date() }).where(eq(grantDisbursements.id, id));
}

export async function findDisbursementByPfmsTxnId(pfmsTxnId: string): Promise<DisbursementRow | null> {
  const rows = await db.select().from(grantDisbursements).where(eq(grantDisbursements.pfmsTxnId, pfmsTxnId)).limit(1);
  return rows[0] ?? null;
}

export async function insertPfmsRecord(tx: Writer, row: PfmsRecordInsert): Promise<void> {
  await tx.insert(grantPfmsRecords).values(row);
}

export async function markPfmsReconciled(tx: Writer, disbursementId: string): Promise<void> {
  await tx.update(grantPfmsRecords)
    .set({ reconciled: true, reconciledAt: new Date(), updatedAt: new Date() })
    .where(eq(grantPfmsRecords.disbursementId, disbursementId));
}
