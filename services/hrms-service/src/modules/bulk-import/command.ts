/**
 * GAP-HR-EMPLOYEES-IMPORT-02: payloads of the two commands POST /v1/hrms/employees/bulk publishes.
 *
 * The route is CQRS (f3-leftover-hrms-cqrs.test.ts): it validates and publishes, it never writes. The consumer
 * (consumer.ts) records the batch and its pending rows in ONE transaction and only then publishes the
 * per-employee hrms.employee.create commands, so every create has a row to mark 'created' / 'failed'.
 */

/**
 * Rows carried by one record command. A batch can hold up to 500 employees; one message with all of them
 * (each carries name, contact fields and ids) would approach the queue transport's message-size ceiling, so the
 * route splits it. The consumer is chunk-safe: see insertBatch in repo.ts.
 */
export const RECORD_CHUNK_SIZE = 100;

/** One employee row of a batch, identified the way the status route names it. */
export interface BulkImportItem {
  /** Also the hrms.employee.create messageId and the new employee's id. */
  id: string;
  /** 1-based position in the POSTed `employees` array. */
  rowNo: number;
  employeeNo: string;
}

/** A row plus the exact payload of the hrms.employee.create command to publish once the batch is recorded. */
export interface BulkImportRecordItem extends BulkImportItem {
  create: Record<string, unknown>;
}

/** hrms.employee.bulk_import.record -- record these rows (pending), then fan their create commands out. */
export interface BulkImportRecordPayload {
  batchId: string;
  /** Rows in the whole batch, not just in this command. */
  total: number;
  items: BulkImportRecordItem[];
}

/** hrms.employee.bulk_import.not_queued -- these rows were never handed to the queue; record them as failed. */
export interface BulkImportNotQueuedPayload {
  batchId: string;
  total: number;
  items: BulkImportItem[];
}
