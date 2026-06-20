import {
  pgSchema, uuid, text, varchar, char, bigint, integer, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

export const disbursementSchema = pgSchema("disbursement");

export const grantInstallments = disbursementSchema.table("grant_installments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  applicationId:  uuid("application_id").notNull(),
  installmentNo:  integer("installment_no").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  status:         varchar("status", { length: 24 }).notNull().default("pending"),
  condition:      text("condition"),
  dueDate:        date("due_date"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const grantDisbursements = disbursementSchema.table("grant_disbursements", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  installmentId:      uuid("installment_id").notNull(),
  amountMinor:        bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:           char("currency", { length: 3 }).notNull().default("INR"),
  mode:               varchar("mode", { length: 16 }).notNull().default("PFMS"),
  pfmsTxnId:          text("pfms_txn_id"),             // PFMS transaction reference
  beneficiaryBankRef: text("beneficiary_bank_ref"),    // opaque "grant_bank_accounts:UUID"
  status:             varchar("status", { length: 24 }).notNull().default("initiated"),
  disbursedAt:        timestamp("disbursed_at", { withTimezone: true }),
  failureReason:      text("failure_reason"),
  retryCount:         integer("retry_count").notNull().default(0),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export const grantPfmsRecords = disbursementSchema.table("grant_pfms_records", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  disbursementId: uuid("disbursement_id").notNull(),
  pfmsTxnId:      text("pfms_txn_id").notNull(),
  reconciled:     boolean("reconciled").notNull().default(false),
  reconciledAt:   timestamp("reconciled_at", { withTimezone: true }),
  rawResponse:    text("raw_response"),                // JSON stored as text
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type InstallmentRow    = typeof grantInstallments.$inferSelect;
export type InstallmentInsert = typeof grantInstallments.$inferInsert;
export type DisbursementRow    = typeof grantDisbursements.$inferSelect;
export type DisbursementInsert = typeof grantDisbursements.$inferInsert;
export type PfmsRecordRow    = typeof grantPfmsRecords.$inferSelect;
export type PfmsRecordInsert = typeof grantPfmsRecords.$inferInsert;

export const schema = { grantInstallments, grantDisbursements, grantPfmsRecords };
