import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const refundSchema = pgSchema("refund");

export const refundDisbursements = refundSchema.table("refund_disbursements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestId: uuid("request_id").notNull(),
  bankAccountDetails: jsonb("bank_account_details").$type<{
    accountNumber: string;
    ifscCode: string;
    accountHolderName: string;
    bankName?: string;
  }>().notNull(),
  disbursementRef: text("disbursement_ref"),
  disbursedAmountMinor: bigint("disbursed_amount_minor", { mode: "bigint" }).notNull(),
  disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
  status: varchar("status", { length: 32 }).notNull().default("initiated"),
  failureReason: text("failure_reason"),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  reconciledBy: uuid("reconciled_by"),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DisbursementRow = typeof refundDisbursements.$inferSelect;
export type DisbursementInsert = typeof refundDisbursements.$inferInsert;

export const schema = { refundDisbursements };
