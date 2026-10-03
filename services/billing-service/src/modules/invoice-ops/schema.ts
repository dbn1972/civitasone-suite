/** invoice-ops tables (migration 0019): offline payment requests, billing settings, reminders. */
import { uuid, varchar, text, bigint, integer, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { invoicesSchema } from "../invoices/schema.js";

export const billingOfflinePayments = invoicesSchema.table("billing_offline_payments", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  mode: varchar("mode", { length: 8 }).notNull(),
  reference: varchar("reference", { length: 40 }).notNull(),
  referenceNorm: varchar("reference_norm", { length: 40 }).notNull(),
  paidOn: date("paid_on").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  paymentId: uuid("payment_id"),
  autoApproved: boolean("auto_approved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const billingSettings = invoicesSchema.table("billing_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  offlineMakerChecker: boolean("offline_maker_checker").notNull().default(true),
  reminderOverdueDays: integer("reminder_overdue_days"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const billingSettingRequests = invoicesSchema.table("billing_setting_requests", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  settingKey: varchar("setting_key", { length: 32 }).notNull(),
  requestedValue: boolean("requested_value").notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const billingInvoiceReminders = invoicesSchema.table("billing_invoice_reminders", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  triggerKind: varchar("trigger_kind", { length: 10 }).notNull(),
  requestedBy: uuid("requested_by"),
  recipientCount: integer("recipient_count").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OfflinePaymentRow = typeof billingOfflinePayments.$inferSelect;
export const schema = { billingOfflinePayments, billingSettings, billingSettingRequests, billingInvoiceReminders };
