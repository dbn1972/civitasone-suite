import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { grantInstallments, grantDisbursements, grantPfmsRecords, type InstallmentRow, type InstallmentInsert, type DisbursementRow, type DisbursementInsert, type PfmsRecordInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findInstallmentById(id: string, tenantId: string): Promise<InstallmentRow | null> {
  const rows = await db.select().from(grantInstallments)
    .where(and(eq(grantInstallments.id, id), eq(grantInstallments.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findInstallmentByIdTx(tx: Writer, id: string, tenantId: string): Promise<InstallmentRow | null> {
  const rows = await (tx as typeof db).select().from(grantInstallments)
    .where(and(eq(grantInstallments.id, id), eq(grantInstallments.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findInstallmentsByApplication(applicationId: string, tenantId: string, limit = 500): Promise<InstallmentRow[]> {
  return db.select().from(grantInstallments)
    .where(and(eq(grantInstallments.applicationId, applicationId), eq(grantInstallments.tenantId, tenantId)))
    .limit(limit);
}

export async function findDisbursementsByApplicationId(applicationId: string, tenantId: string): Promise<DisbursementRow[]> {
  const installments = await findInstallmentsByApplication(applicationId, tenantId);
  if (!installments.length) return [];
  const ids = installments.map((i) => i.id);
  const all: DisbursementRow[] = [];
  for (const id of ids) {
    const rows = await db.select().from(grantDisbursements).where(eq(grantDisbursements.installmentId, id)).limit(500);
    all.push(...rows);
  }
  return all;
}

export async function sumDisbursedForApplication(tx: Writer, applicationId: string, tenantId: string): Promise<bigint> {
  // P1-1: count only COMPLETED disbursements (post-EFT settlement), not the
  // optimistic installment status. A failed/initiated disbursement must NOT
  // inflate the approved/UC ceiling. Tenant-scoped (P1 isolation).
  const installments = await (tx as typeof db).select({ id: grantInstallments.id })
    .from(grantInstallments)
    .where(and(eq(grantInstallments.applicationId, applicationId), eq(grantInstallments.tenantId, tenantId)));
  if (!installments.length) return 0n;
  const ids = installments.map((i) => i.id);
  const rows = await (tx as typeof db).select({ amountMinor: grantDisbursements.amountMinor })
    .from(grantDisbursements)
    .where(and(
      inArray(grantDisbursements.installmentId, ids),
      eq(grantDisbursements.tenantId, tenantId),
      eq(grantDisbursements.status, "completed"),
    ));
  return rows.reduce((acc, r) => acc + r.amountMinor, 0n);
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

export async function findDisbursementByPfmsTxnId(pfmsTxnId: string, tenantId: string): Promise<DisbursementRow | null> {
  const rows = await db.select().from(grantDisbursements)
    .where(and(eq(grantDisbursements.pfmsTxnId, pfmsTxnId), eq(grantDisbursements.tenantId, tenantId)))
    .limit(1);
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

export async function listDisbursementsByTenant(tenantId: string, limit: number): Promise<DisbursementRow[]> {
  return db.select().from(grantDisbursements)
    .where(eq(grantDisbursements.tenantId, tenantId))
    .limit(limit);
}

export async function listInstallmentsByTenant(tenantId: string, limit = 200): Promise<InstallmentRow[]> {
  return db.select().from(grantInstallments)
    .where(eq(grantInstallments.tenantId, tenantId))
    .limit(limit);
}

/**
 * Chain #4: installments awaiting a specific project milestone that are eligible
 * for release. "Releasable" = milestone-linked AND not yet disbursed/initiated
 * (i.e. still `pending`). Tenant-scoped.
 */
export async function findReleasableInstallmentsByMilestone(
  tx: Writer, milestoneId: string, tenantId: string,
): Promise<InstallmentRow[]> {
  return (tx as typeof db).select().from(grantInstallments)
    .where(and(
      eq(grantInstallments.milestoneId, milestoneId),
      eq(grantInstallments.tenantId, tenantId),
      eq(grantInstallments.status, "pending"),
    ));
}
