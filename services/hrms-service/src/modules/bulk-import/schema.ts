import { uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { employeeSchema } from "../employee/schema.js";

/**
 * GAP-HR-EMPLOYEES-IMPORT-02 (migration 0250): one row per accepted POST
 * /v1/hrms/employees/bulk, and one row per employee in it, so the status route
 * can report what the queued hrms.employee.create messages actually did.
 * Employee number + a stable failure code only -- no PII, no raw error text.
 */
export const hrmsBulkImportBatches = employeeSchema.table("hrms_bulk_import_batches", {
  id:            uuid("id").primaryKey(),
  tenantId:      uuid("tenant_id").notNull(),
  total:         integer("total").notNull(),
  requestedBy:   uuid("requested_by").notNull(),
  correlationId: varchar("correlation_id", { length: 64 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsBulkImportRows = employeeSchema.table("hrms_bulk_import_rows", {
  /** The hrms.employee.create messageId == the new employee's id. */
  messageId:  uuid("message_id").primaryKey(),
  tenantId:   uuid("tenant_id").notNull(),
  batchId:    uuid("batch_id").notNull(),
  /** 1-based position in the POSTed `employees` array. */
  rowNo:      integer("row_no").notNull(),
  employeeNo: varchar("employee_no", { length: 32 }).notNull(),
  status:     varchar("status", { length: 16 }).notNull().default("pending"), // pending | created | failed
  errorCode:  varchar("error_code", { length: 64 }),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ImportBatchRow = typeof hrmsBulkImportRows.$inferSelect;

export const bulkImportSchema = { hrmsBulkImportBatches, hrmsBulkImportRows };
