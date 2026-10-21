import { and, asc, eq, ne } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsBulkImportBatches, hrmsBulkImportRows } from "./schema.js";
import { IMPORT_FAILURE, type ImportFailureCode } from "./failure.js";

/** A transaction handle the consumer / route already holds (never opens a nested one). */
export type Tx = Pick<typeof db, "insert" | "update" | "select">;

export interface NewBatch {
  id: string;
  tenantId: string;
  requestedBy: string;
  correlationId: string | null;
  rows: Array<{ messageId: string; rowNo: number; employeeNo: string }>;
}

/** Record an accepted batch and its (pending) rows. Run in the route's transaction, BEFORE anything is queued. */
export async function insertBatch(tx: Tx, b: NewBatch): Promise<void> {
  await tx.insert(hrmsBulkImportBatches).values({
    id: b.id, tenantId: b.tenantId, total: b.rows.length, requestedBy: b.requestedBy, correlationId: b.correlationId,
  });
  await tx.insert(hrmsBulkImportRows).values(
    b.rows.map((r) => ({
      messageId: r.messageId, tenantId: b.tenantId, batchId: b.id, rowNo: r.rowNo, employeeNo: r.employeeNo, status: "pending",
    })),
  );
}

/**
 * pending|failed -> created. Called by the create consumer inside the transaction that inserts the
 * employee. "failed" may be overridden because the employee row is the ground truth: a row marked
 * NOT_QUEUED by the route after an ambiguous publish error that was in fact delivered still ends up
 * 'created'. A row that is already created is left alone.
 */
export async function markRowCreated(tx: Tx, tenantId: string, messageId: string): Promise<void> {
  await tx.update(hrmsBulkImportRows)
    .set({ status: "created", errorCode: null, updatedAt: new Date() })
    .where(and(eq(hrmsBulkImportRows.tenantId, tenantId), eq(hrmsBulkImportRows.messageId, messageId), ne(hrmsBulkImportRows.status, "created")));
}

/** pending -> failed with a stable code. Never touches a row that is already created. */
export async function markRowFailed(tx: Tx, tenantId: string, messageId: string, code: ImportFailureCode): Promise<void> {
  await tx.update(hrmsBulkImportRows)
    .set({ status: "failed", errorCode: code, updatedAt: new Date() })
    .where(and(eq(hrmsBulkImportRows.tenantId, tenantId), eq(hrmsBulkImportRows.messageId, messageId), eq(hrmsBulkImportRows.status, "pending")));
}

export interface BatchStatus {
  batchId: string;
  status: "processing" | "completed";
  total: number;
  created: number;
  failed: number;
  pending: number;
  failedRows: Array<{ rowNo: number; employeeNo: string; code: string }>;
}

/** Real per-row state of a batch, or null when no such batch exists in THIS tenant. */
export async function getBatchStatus(tenantId: string, batchId: string): Promise<BatchStatus | null> {
  const found = await scopedRead(async (tx) => {
    const batch = await tx.select({ id: hrmsBulkImportBatches.id, total: hrmsBulkImportBatches.total }).from(hrmsBulkImportBatches)
      .where(and(eq(hrmsBulkImportBatches.id, batchId), eq(hrmsBulkImportBatches.tenantId, tenantId))).limit(1);
    if (!batch[0]) return null;
    const rows = await tx.select({
      rowNo: hrmsBulkImportRows.rowNo, employeeNo: hrmsBulkImportRows.employeeNo,
      status: hrmsBulkImportRows.status, errorCode: hrmsBulkImportRows.errorCode,
    }).from(hrmsBulkImportRows)
      .where(and(eq(hrmsBulkImportRows.batchId, batchId), eq(hrmsBulkImportRows.tenantId, tenantId)))
      .orderBy(asc(hrmsBulkImportRows.rowNo));
    return { total: batch[0].total, rows };
  });
  if (!found) return null;
  const created = found.rows.filter((r) => r.status === "created").length;
  const failedRows = found.rows
    .filter((r) => r.status === "failed")
    .map((r) => ({ rowNo: r.rowNo, employeeNo: r.employeeNo, code: r.errorCode ?? IMPORT_FAILURE.CREATE_FAILED }));
  const failed = failedRows.length;
  // A row that is not created and not failed is still pending; any row missing from the table counts as pending too.
  const pending = Math.max(0, found.total - created - failed);
  return { batchId, status: pending === 0 ? "completed" : "processing", total: found.total, created, failed, pending, failedRows };
}
