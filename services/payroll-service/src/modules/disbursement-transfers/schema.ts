/**
 * payroll.disbursement_transfers -- per-employee bank transfer ledger
 * (migration 0053). See that migration for the row lifecycle. Only the last
 * 4 characters of the beneficiary account are ever stored here.
 */
import {
  pgSchema, uuid, varchar, bigint, text, timestamp, integer, boolean,
} from "drizzle-orm/pg-core";

const payrollSchema = pgSchema("payroll");

export const TRANSFER_STATUSES = ["pending", "sent", "success", "failed", "returned"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const disbursementTransfers = payrollSchema.table("disbursement_transfers", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  runId:            uuid("run_id").notNull(),
  slipId:           uuid("slip_id"),
  employeeId:       uuid("employee_id").notNull(),
  employeeNo:       varchar("employee_no", { length: 32 }).notNull(),
  beneficiaryName:  text("beneficiary_name").notNull(),
  amountMinor:      bigint("amount_minor", { mode: "bigint" }).notNull(),
  ifsc:             varchar("ifsc", { length: 11 }).notNull(),
  accountLast4:     varchar("account_last4", { length: 4 }),
  issuanceId:       uuid("issuance_id"),
  fileFormat:       varchar("file_format", { length: 8 }),
  fileReference:    text("file_reference"),
  status:           varchar("status", { length: 16 }).$type<TransferStatus>().notNull().default("pending"),
  reasonCode:       varchar("reason_code", { length: 8 }),
  reasonText:       text("reason_text"),
  attemptNo:        integer("attempt_no").notNull().default(1),
  parentTransferId: uuid("parent_transfer_id"),
  idempotencyKey:   varchar("idempotency_key", { length: 128 }),
  requestHash:      varchar("request_hash", { length: 64 }),
  requestReason:    varchar("request_reason", { length: 500 }),
  sentAt:           timestamp("sent_at", { withTimezone: true }),
  settledAt:        timestamp("settled_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
});

export type DisbursementTransferRow = typeof disbursementTransfers.$inferSelect;

export const ISSUANCE_MODES = ["first", "incremental", "full_reissue"] as const;
export type IssuanceMode = (typeof ISSUANCE_MODES)[number];

/** One row per generated bank file (migration 0053). */
export const disbursementFileIssuances = payrollSchema.table("disbursement_file_issuances", {
  id:                uuid("id").primaryKey(),
  tenantId:          uuid("tenant_id").notNull(),
  runId:             uuid("run_id").notNull(),
  seq:               integer("seq").notNull(),
  mode:              varchar("mode", { length: 16 }).$type<IssuanceMode>().notNull(),
  fileFormat:        varchar("file_format", { length: 8 }).notNull(),
  fileName:          text("file_name").notNull(),
  batchFrom:         integer("batch_from"),
  batchTo:           integer("batch_to"),
  lineCount:         integer("line_count").notNull(),
  totalMinor:        bigint("total_minor", { mode: "bigint" }).notNull(),
  reason:            varchar("reason", { length: 500 }).notNull(),
  fullReissueReason: varchar("full_reissue_reason", { length: 500 }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  // Migration 0074 (GAP-PAYROLL-DISBURSEMENT-03): signature of the issued file.
  /** NULL = issued before signing existed (treated as unsigned). */
  signatureFormat:        varchar("signature_format", { length: 16 }),
  /** Detached signature: armoured text (pgp) or base64 DER (pkcs7); NULL for xml_dsig / none. */
  signature:              text("signature"),
  /** hex sha256 of the signed bytes (pre encrypt-to-bank wrapping). */
  fileSha256:             varchar("file_sha256", { length: 64 }),
  signedAt:               timestamp("signed_at", { withTimezone: true }),
  signingKeyFingerprint:  varchar("signing_key_fingerprint", { length: 128 }),
  encryptedToBank:        boolean("encrypted_to_bank").notNull().default(false),
});

export const schema = { disbursementTransfers, disbursementFileIssuances };
