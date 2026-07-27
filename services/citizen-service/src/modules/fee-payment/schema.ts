import { pgSchema, uuid, text, varchar, integer, bigint, timestamp, jsonb, boolean, primaryKey } from "drizzle-orm/pg-core";
import type { ExemptionRule } from "./domain.js";

export const feeSchema = pgSchema("fee");

/** Atomic per-(tenant, year) offline-receipt sequence — replaces the racy count(*)+1. */
export const feeReceiptCounters = feeSchema.table("receipt_counters", {
  tenantId:  uuid("tenant_id").notNull(),
  year:      integer("year").notNull(),
  lastSeq:   integer("last_seq").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.year] }) }));

export const feeSchedules = feeSchema.table("schedules", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  serviceId:   uuid("service_id").notNull(),
  name:        text("name").notNull(),
  baseAmount:  bigint("base_amount", { mode: "number" }).notNull().default(0),
  currency:    varchar("currency", { length: 3 }).notNull().default("INR"),
  exemptions:  jsonb("exemptions").$type<ExemptionRule[]>().notNull().default([]),
  active:      boolean("active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  rowVersion:  integer("row_version").notNull().default(1),
});

export const feePayments = feeSchema.table("payments", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  applicationId:        uuid("application_id").notNull(),
  scheduleId:           uuid("schedule_id"),
  citizenId:            uuid("citizen_id"),
  amount:               bigint("amount", { mode: "number" }).notNull(),
  currency:             varchar("currency", { length: 3 }).notNull().default("INR"),
  exemptionApplied:     text("exemption_applied"),
  method:               varchar("method", { length: 16 }).notNull(),
  status:               varchar("status", { length: 24 }).notNull().default("pending"),
  gatewayRef:           text("gateway_ref"),
  receiptNo:            text("receipt_no"),
  receiptIssuedAt:      timestamp("receipt_issued_at", { withTimezone: true }),
  reconciliationStatus: varchar("reconciliation_status", { length: 16 }).notNull().default("unreconciled"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
  rowVersion:           integer("row_version").notNull().default(1),
});

export const feeRefunds = feeSchema.table("refunds", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  paymentId:   uuid("payment_id").notNull(),
  amount:      bigint("amount", { mode: "number" }).notNull(),
  reason:      text("reason"),
  status:      varchar("status", { length: 16 }).notNull().default("requested"),
  requestedBy: uuid("requested_by").notNull(),
  approvedBy:  uuid("approved_by"),
  decidedAt:   timestamp("decided_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  rowVersion:  integer("row_version").notNull().default(1),
});

export type FeeScheduleRow    = typeof feeSchedules.$inferSelect;
export type FeeScheduleInsert = typeof feeSchedules.$inferInsert;
export type PaymentRow        = typeof feePayments.$inferSelect;
export type PaymentInsert     = typeof feePayments.$inferInsert;
export type RefundRow         = typeof feeRefunds.$inferSelect;
export type RefundInsert      = typeof feeRefunds.$inferInsert;

export const schema = { feeSchedules, feePayments, feeRefunds, feeReceiptCounters };
