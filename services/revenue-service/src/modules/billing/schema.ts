/**
 * Billing schema — bills and challans generated from demands.
 *
 * PG schema: `billing`
 * _Requirements: SVC-132_
 */
import {
  pgSchema, uuid, text, integer, varchar, timestamp, date, bigint, jsonb,
} from "drizzle-orm/pg-core";

export const billingSchema = pgSchema("billing");

export const bills = billingSchema.table("bills", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  demandId:       uuid("demand_id").notNull(),
  assessmentId:   uuid("assessment_id").notNull(),
  billNo:         varchar("bill_no", { length: 32 }).notNull(),
  billDate:       date("bill_date").notNull(),
  dueDate:        date("due_date").notNull(),
  principalMinor: bigint("principal_minor", { mode: "bigint" }).notNull(),
  rebateMinor:    bigint("rebate_minor", { mode: "bigint" }).notNull().default(0n),
  penaltyMinor:   bigint("penalty_minor", { mode: "bigint" }).notNull().default(0n),
  totalMinor:     bigint("total_minor", { mode: "bigint" }).notNull(),
  receiptHeadCode: varchar("receipt_head_code", { length: 32 }).notNull(), // GL mapping
  status:         varchar("status", { length: 16 }).notNull().default("issued"), // issued, paid, cancelled
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type BillRow = typeof bills.$inferSelect;
export type BillInsert = typeof bills.$inferInsert;

export const schema = { bills };
