import { pgSchema, uuid, varchar, char, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";

export const invoicesSchema = pgSchema("invoices");

export const billingInvoices = invoicesSchema.table("billing_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  periodMonth: char("period_month", { length: 7 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull().default(0n),
  taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull().default(0n),
  chargesMinor: bigint("charges_minor", { mode: "bigint" }).notNull().default(0n),
  paidMinor: bigint("paid_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  issuedBy: uuid("issued_by"),
  cancelledBy: uuid("cancelled_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const billingInvoiceItems = invoicesSchema.table("billing_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  description: text("description").notNull(),
  kind: varchar("kind", { length: 16 }).notNull().default("line"),
  quantity: bigint("quantity", { mode: "bigint" }).notNull().default(1n),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const billingInvoiceApprovals = invoicesSchema.table("billing_invoice_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  action: varchar("action", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  requestedBy: uuid("requested_by").notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BillingInvoiceRow = typeof billingInvoices.$inferSelect;
export type BillingInvoiceInsert = typeof billingInvoices.$inferInsert;
export type BillingInvoiceItemRow = typeof billingInvoiceItems.$inferSelect;
export type BillingInvoiceItemInsert = typeof billingInvoiceItems.$inferInsert;
export type BillingInvoiceApprovalRow = typeof billingInvoiceApprovals.$inferSelect;
export type BillingInvoiceApprovalInsert = typeof billingInvoiceApprovals.$inferInsert;
export const schema = { billingInvoices, billingInvoiceItems, billingInvoiceApprovals };
