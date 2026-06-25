import { pgSchema, uuid, varchar, char, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";

export const paymentsSchema = pgSchema("payments");

export const billingPayments = paymentsSchema.table("billing_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  method: varchar("method", { length: 32 }).notNull().default("gateway"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  receiptNo: text("receipt_no"),
  reference: text("reference"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const billingGatewayTxns = paymentsSchema.table("billing_gateway_txns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  gateway: varchar("gateway", { length: 32 }).notNull().default("razorpay"),
  gatewayRef: text("gateway_ref"),
  status: varchar("status", { length: 24 }).notNull().default("initiated"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BillingPaymentRow = typeof billingPayments.$inferSelect;
export type BillingPaymentInsert = typeof billingPayments.$inferInsert;
export type BillingGatewayTxnInsert = typeof billingGatewayTxns.$inferInsert;
export const schema = { billingPayments, billingGatewayTxns };
