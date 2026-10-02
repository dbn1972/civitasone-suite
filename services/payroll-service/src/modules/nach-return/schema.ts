import {
  pgSchema, uuid, varchar, bigint, text, timestamp, char,
} from "drizzle-orm/pg-core";

const payrollSchema = pgSchema("payroll");

export const nachReturnRecords = payrollSchema.table("nach_return_records", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  runId:       uuid("run_id").notNull(),
  slipId:      uuid("slip_id"),
  employeeNo:  varchar("employee_no", { length: 32 }).notNull(),
  statusCode:  varchar("status_code", { length: 2 }).notNull(),
  reasonCode:  varchar("reason_code", { length: 4 }),
  reasonText:  text("reason_text"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

/** One row per distinct NACH return upload per run (migration 0053). */
export const nachReturnFiles = payrollSchema.table("nach_return_files", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  runId:         uuid("run_id").notNull(),
  fileHash:      char("file_hash", { length: 64 }).notNull(),
  fileReference: text("file_reference"),
  messageId:     uuid("message_id").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export type NachReturnRecordRow = typeof nachReturnRecords.$inferSelect;
export type NachReturnRecordInsert = typeof nachReturnRecords.$inferInsert;

export const schema = { nachReturnRecords, nachReturnFiles };
