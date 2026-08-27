import { eq, and, ne, sql } from "drizzle-orm";
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

/**
 * FIN-3 / double-disbursement guard: the only disbursement state that does
 * NOT represent money either in flight or already sent is "failed" (a failed
 * attempt is safe to retry — see reconciliation/routes.ts, which allows a
 * fresh initiate from request status "failed"). This returns the active
 * (non-failed) disbursement for a request, if any, so callers can refuse to
 * create a second one while one is already initiated/processing/completed.
 * Previously this module only had a bare `findByRequest` that nothing called
 * at all — no route or consumer ever checked for an existing disbursement
 * before creating another one.
 */
export async function findActiveByRequest(requestId: string, tenantId: string): Promise<DisbursementRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(refundDisbursements)
      .where(and(
        eq(refundDisbursements.requestId, requestId),
        eq(refundDisbursements.tenantId, tenantId),
        ne(refundDisbursements.status, "failed"),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Same check as `findActiveByRequest`, scoped to an existing transaction so
 * the consumer can re-verify atomically (with respect to its own single,
 * strictly-sequential per-topic poll loop) immediately before inserting. */
export async function findActiveByRequestTx(
  tx: ScopedTx,
  requestId: string,
  tenantId: string,
): Promise<DisbursementRow | null> {
  const rows = await tx.select().from(refundDisbursements)
    .where(and(
      eq(refundDisbursements.requestId, requestId),
      eq(refundDisbursements.tenantId, tenantId),
      ne(refundDisbursements.status, "failed"),
    ))
    .limit(1);
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
      ...(status === "completed" ? { disbursedAt: new Date() } : {}),
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
