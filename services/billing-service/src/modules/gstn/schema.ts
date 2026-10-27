import { pgSchema, uuid, varchar, char, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";

const invoicesSchema = pgSchema("invoices");

/** GAP-BILLING-GSTN-05 (migration 0024): one row per GST return filed through the console. */
export const billingGstnReturns = invoicesSchema.table("billing_gstn_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  gstin: varchar("gstin", { length: 15 }).notNull(),
  returnPeriod: char("return_period", { length: 7 }).notNull(),
  returnType: varchar("return_type", { length: 8 }).notNull(),
  referenceId: text("reference_id").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("submitted"),
  totalTaxableMinor: bigint("total_taxable_minor", { mode: "bigint" }).notNull().default(0n),
  totalCgstMinor: bigint("total_cgst_minor", { mode: "bigint" }).notNull().default(0n),
  totalSgstMinor: bigint("total_sgst_minor", { mode: "bigint" }).notNull().default(0n),
  totalIgstMinor: bigint("total_igst_minor", { mode: "bigint" }).notNull().default(0n),
  filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BillingGstnReturnRow = typeof billingGstnReturns.$inferSelect;
export type BillingGstnReturnInsert = typeof billingGstnReturns.$inferInsert;
export const schema = { billingGstnReturns };
