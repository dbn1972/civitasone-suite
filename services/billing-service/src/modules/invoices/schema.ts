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
  // Owner decision #26: GST tax-invoice fields (migration 0021). Nullable for legacy rows.
  supplierGstin: varchar("supplier_gstin", { length: 15 }),
  recipientGstin: varchar("recipient_gstin", { length: 15 }),
  placeOfSupply: char("place_of_supply", { length: 2 }),
  cgstMinor: bigint("cgst_minor", { mode: "bigint" }).notNull().default(0n),
  sgstMinor: bigint("sgst_minor", { mode: "bigint" }).notNull().default(0n),
  igstMinor: bigint("igst_minor", { mode: "bigint" }).notNull().default(0n),
  // F11 (migration 0022): sequential tax-invoice number, allocated at issue. NULL on drafts and legacy rows.
  invoiceSeries: varchar("invoice_series", { length: 15 }),
  invoiceNumber: varchar("invoice_number", { length: 16 }),
  issuedBy: uuid("issued_by"),
  cancelledBy: uuid("cancelled_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** F11: the supplier's legal invoice series (shared across customer tenants, no tenant data, no RLS). */
export const billingInvoiceSeries = invoicesSchema.table("billing_invoice_series", {
  supplierGstin: varchar("supplier_gstin", { length: 15 }).notNull(),
  fiscalYear: char("fiscal_year", { length: 4 }).notNull(),
  lastSeq: bigint("last_seq", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingInvoiceItems = invoicesSchema.table("billing_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  description: text("description").notNull(),
  kind: varchar("kind", { length: 16 }).notNull().default("line"),
  hsnSac: varchar("hsn_sac", { length: 8 }),
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
export const schema = { billingInvoices, billingInvoiceSeries, billingInvoiceItems, billingInvoiceApprovals };
