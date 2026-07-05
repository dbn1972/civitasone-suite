import {
  pgSchema, uuid, varchar, integer, text, timestamp, jsonb,
} from "drizzle-orm/pg-core";

const payrollSchema = pgSchema("payroll");

export const form16BulkJobs = payrollSchema.table("form16_bulk_jobs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  fy:              varchar("fy", { length: 7 }).notNull(),
  status:          varchar("status", { length: 16 }).notNull().default("pending"),
  totalEmployees:  integer("total_employees").notNull().default(0),
  generated:       integer("generated").notNull().default(0),
  failed:          integer("failed").notNull().default(0),
  storagePrefix:   text("storage_prefix"),
  errorDetails:    jsonb("error_details"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
  createdBy:       uuid("created_by").notNull(),
});

export type Form16BulkJobRow = typeof form16BulkJobs.$inferSelect;
export type Form16BulkJobInsert = typeof form16BulkJobs.$inferInsert;

export const schema = { form16BulkJobs };
