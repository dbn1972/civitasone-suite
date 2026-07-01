import { pgSchema, uuid, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";

export const einvoiceSchema = pgSchema("einvoice");

export const einvoiceRequests = einvoiceSchema.table("billing_einvoice_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  irn: text("irn"),
  ackNo: text("ack_no"),
  ackDate: timestamp("ack_date", { withTimezone: true }),
  signedInvoice: text("signed_invoice"),
  signedQrCode: text("signed_qr_code"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  errorMessage: text("error_message"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type EInvoiceRequestRow = typeof einvoiceRequests.$inferSelect;
export type EInvoiceRequestInsert = typeof einvoiceRequests.$inferInsert;
export const schema = { einvoiceRequests };
