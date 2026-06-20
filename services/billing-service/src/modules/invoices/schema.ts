import { pgSchema, uuid, varchar, char, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";

export const invoicesSchema = pgSchema("invoices");

export const billingInvoices = invoicesSchema.table("billing_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  periodMonth: char("period_month", { length: 7 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
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
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BillingInvoiceInsert = typeof billingInvoices.$inferInsert;
export type BillingInvoiceItemInsert = typeof billingInvoiceItems.$inferInsert;
export const schema = { billingInvoices, billingInvoiceItems };
