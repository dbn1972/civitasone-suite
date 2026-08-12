import { eq, and, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { refundDisbursements, type DisbursementRow, type DisbursementInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<DisbursementRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundDisbursements)
      .where(and(eq(refundDisbursements.id, id), eq(refundDisbursements.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByRequest(requestId: string, tenantId: string): Promise<DisbursementRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundDisbursements)
      .where(and(eq(refundDisbursements.requestId, requestId), eq(refundDisbursements.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertDisbursement(tx: ScopedTx, row: DisbursementInsert): Promise<void> {
  await tx.insert(refundDisbursements).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(refundDisbursements)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      disbursedAt: status === "completed" ? new Date() : undefined,
      version: sql`${refundDisbursements.version} + 1`,
    })
    .where(and(eq(refundDisbursements.id, id), eq(refundDisbursements.tenantId, tenantId)))
    .returning({ id: refundDisbursements.id });
  return result.length > 0;
}

export async function markFailed(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  reason: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(refundDisbursements)
    .set({
      status: "failed",
      failureReason: reason,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${refundDisbursements.version} + 1`,
    })
    .where(and(eq(refundDisbursements.id, id), eq(refundDisbursements.tenantId, tenantId)))
    .returning({ id: refundDisbursements.id });
  return result.length > 0;
}

export async function reconcile(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  reconciledBy: string,
): Promise<boolean> {
  const result = await tx.update(refundDisbursements)
    .set({
      reconciledAt: new Date(),
      reconciledBy,
      updatedBy: reconciledBy,
      updatedAt: new Date(),
      version: sql`${refundDisbursements.version} + 1`,
    })
    .where(and(eq(refundDisbursements.id, id), eq(refundDisbursements.tenantId, tenantId)))
    .returning({ id: refundDisbursements.id });
  return result.length > 0;
}
