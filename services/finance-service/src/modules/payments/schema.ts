import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, jsonb, date, boolean,
} from "drizzle-orm/pg-core";

export const paymentsSchema = pgSchema("payments");

export type Deduction = { type: string; amountMinor: number; description?: string };

export const financeBills = paymentsSchema.table("finance_bills", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  billNo:      text("bill_no").notNull(),
  vendorId:    uuid("vendor_id").notNull(),
  headId:      uuid("head_id").notNull(),
  sanctionRef: uuid("sanction_ref"),
  grossMinor:  bigint("gross_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  deductions:  jsonb("deductions").$type<Deduction[]>().notNull().default([]),
  netMinor:    bigint("net_minor", { mode: "bigint" }).notNull().default(0n),
  poRef:       text("po_ref"),
  grnRef:      text("grn_ref"),
  poAmountMinor:  bigint("po_amount_minor", { mode: "bigint" }),   // R5: authoritative PO value snapshot (paise)
  grnAmountMinor: bigint("grn_amount_minor", { mode: "bigint" }),  // R5: authoritative GRN accepted value snapshot (paise)
  billDate:    date("bill_date"),
  ddoCode:     varchar("ddo_code", { length: 12 }),
  paoCode:     varchar("pao_code", { length: 12 }),
  agencyCode:  varchar("agency_code", { length: 12 }),
  schemeCode:  varchar("scheme_code", { length: 20 }),
  stage:       varchar("stage", { length: 32 }).notNull().default("section"),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  isSample:    boolean("is_sample").notNull().default(false),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const financeGrnMatch = paymentsSchema.table("finance_grn_match", {
  tenantId:       uuid("tenant_id").notNull(),
  grnRef:         text("grn_ref").notNull(),
  poRef:          text("po_ref").notNull(),
  vendorId:       uuid("vendor_id").notNull(),
  poAmountMinor:  bigint("po_amount_minor", { mode: "bigint" }).notNull().default(0n),
  grnAmountMinor: bigint("grn_amount_minor", { mode: "bigint" }).notNull().default(0n),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financePayments = paymentsSchema.table("finance_payments", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  eftRef:      text("eft_ref"),
  billId:      uuid("bill_id").notNull(),
  bankAccountId: uuid("bank_account_id"),
  mode:        varchar("mode", { length: 16 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  utr:         text("utr"),
  ddoCode:     varchar("ddo_code", { length: 12 }),
  paoCode:     varchar("pao_code", { length: 12 }),
  status:      varchar("status", { length: 24 }).notNull().default("initiated"),
  reconciled:  boolean("reconciled").notNull().default(false),
  reconciledLineId: uuid("reconciled_line_id"),
  reconciledAt:     timestamp("reconciled_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

// Append-only payment status history (migrations/0086): every status write also appends a row here.
export const financePaymentEvents = paymentsSchema.table("finance_payment_events", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  status:    varchar("status", { length: 24 }).notNull(),
  actorId:   uuid("actor_id"),
  note:      text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financePfms = paymentsSchema.table("finance_pfms", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  pfmsId:           text("pfms_id").notNull(),
  type:             varchar("type", { length: 32 }).notNull(),
  amountMinor:      bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  beneficiaryCount: integer("beneficiary_count").notNull().default(0),
  agencyCode:       varchar("agency_code", { length: 12 }),
  schemeCode:       varchar("scheme_code", { length: 20 }),
  ddoCode:          varchar("ddo_code", { length: 12 }),
  paoCode:          varchar("pao_code", { length: 12 }),
  bankFileHash:     text("bank_file_hash"),
  signedAt:         timestamp("signed_at", { withTimezone: true }),
  signedBy:         uuid("signed_by"),
  signatureRef:     text("signature_ref"),
  // GAP-FINANCE-PFMS-01 (migration 0090): the DSC signature over the canonical batch, kept so it can be re-verified
  // before submission. dscMock = the sandbox MOCK signer made it (never a legal signature).
  batchDigest:         varchar("batch_digest", { length: 64 }),
  signedInfoHash:      varchar("signed_info_hash", { length: 64 }),
  dscSignature:        text("dsc_signature"),
  dscAlgorithm:        varchar("dsc_algorithm", { length: 64 }),
  dscSignatureMethod:  varchar("dsc_signature_method", { length: 200 }),
  dscCertSerial:       varchar("dsc_cert_serial", { length: 128 }),
  dscSignerRef:        varchar("dsc_signer_ref", { length: 256 }),
  dscProviderKey:      varchar("dsc_provider_key", { length: 64 }),
  dscEnvironment:      varchar("dsc_environment", { length: 16 }),
  dscMock:             boolean("dsc_mock").notNull().default(false),
  dscCanonicalVersion: varchar("dsc_canonical_version", { length: 40 }),
  dscXmldsig:          text("dsc_xmldsig"),
  dscVerifiedAt:       timestamp("dsc_verified_at", { withTimezone: true }),
  submissionStatus: varchar("submission_status", { length: 24 }).notNull().default("pending"),
  status:           varchar("status", { length: 24 }).notNull().default("pending"),
  // Which of the two independent PFMS submission mechanisms produced this
  // row: 'treasury_batch' (routes.ts / integrations SFTP egress — every
  // pre-existing row, via the column default) or 'ekuber_adapter' (the live
  // e-Kuber REST adapter, adapter-routes.ts). See migrations/
  // 0076_pfms_channel_reconciliation.sql for why this exists.
  channel:          varchar("channel", { length: 24 }).notNull().default("treasury_batch"),
  // Bank UTR from the e-Kuber adapter's status-check response. The treasury/
  // SFTP channel's UTR lives on payments.finance_payments instead (see
  // repo.ts's listRealBeneficiaries), so this is only ever populated for
  // channel = 'ekuber_adapter' rows.
  utrNumber:        text("utr_number"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const financeAdvances = paymentsSchema.table("finance_advances", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  advanceNo:      text("advance_no").notNull(),
  beneficiary:    text("beneficiary").notNull(),
  type:           varchar("type", { length: 16 }).notNull().default("employee"),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  disbursedDate:  date("disbursed_date").notNull().defaultNow(),
  dueDate:        date("due_date"),
  adjustedMinor:  bigint("adjusted_minor", { mode: "bigint" }).notNull().default(0n),
  purpose:        text("purpose"),
  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01: who sanctioned the advance and why.
  sanctionAuthority: text("sanction_authority"),
  reason:         text("reason"),
  status:         varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const financeUC = paymentsSchema.table("finance_uc", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  ucNo:          text("uc_no").notNull(),
  grantRef:      text("grant_ref"),
  grantee:       text("grantee").notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  periodFrom:    date("period_from").notNull().defaultNow(),
  periodTo:      date("period_to").notNull().defaultNow(),
  submittedDate: date("submitted_date"),
  purpose:       text("purpose"),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-01 / -01: the certifier's
  // declaration, and the verification outcome (rejection reason + resubmits).
  declarationAccepted: boolean("declaration_accepted").notNull().default(false),
  declaredBy:    uuid("declared_by"),
  declaredAt:    timestamp("declared_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  decidedBy:     uuid("decided_by"),
  decidedAt:     timestamp("decided_at", { withTimezone: true }),
  resubmitCount: integer("resubmit_count").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type BillRow    = typeof financeBills.$inferSelect;
export type BillInsert = typeof financeBills.$inferInsert;
export type GrnMatchRow    = typeof financeGrnMatch.$inferSelect;
export type GrnMatchInsert = typeof financeGrnMatch.$inferInsert;
export type PaymentRow    = typeof financePayments.$inferSelect;
export type PaymentInsert = typeof financePayments.$inferInsert;
export type PaymentEventRow = typeof financePaymentEvents.$inferSelect;
export type AdvanceRow    = typeof financeAdvances.$inferSelect;
export type AdvanceInsert = typeof financeAdvances.$inferInsert;
export type UCRow    = typeof financeUC.$inferSelect;
export type UCInsert = typeof financeUC.$inferInsert;

export const schema = { financeBills, financeGrnMatch, financePayments, financePaymentEvents, financePfms, financeAdvances, financeUC };
