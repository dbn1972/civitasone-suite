import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, text, char } from "drizzle-orm/pg-core";

export const refundSchema = pgSchema("refund");

export const refundRequests = refundSchema.table("refund_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestNumber: varchar("request_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("requested"),
  applicantName: varchar("applicant_name", { length: 256 }).notNull(),
  applicantPhone: varchar("applicant_phone", { length: 15 }).notNull(),
  originalServiceType: varchar("original_service_type", { length: 64 }).notNull(),
  originalTransactionRef: text("original_transaction_ref").notNull(),
  originalAmountMinor: bigint("original_amount_minor", { mode: "bigint" }).notNull(),
  refundAmountMinor: bigint("refund_amount_minor", { mode: "bigint" }).notNull(),
  refundReason: varchar("refund_reason", { length: 32 }).notNull(),
  description: text("description"),
  documents: jsonb("documents").$type<Array<{ docType: string; fileId: string; uploadedAt: string }>>().notNull().default([]),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RefundRequestRow = typeof refundRequests.$inferSelect;
export type RefundRequestInsert = typeof refundRequests.$inferInsert;

export const schema = { refundRequests };
