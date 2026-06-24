import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, jsonb, date,
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
  ddoCode:     varchar("ddo_code", { length: 12 }),
  paoCode:     varchar("pao_code", { length: 12 }),
  agencyCode:  varchar("agency_code", { length: 12 }),
  schemeCode:  varchar("scheme_code", { length: 20 }),
  stage:       varchar("stage", { length: 32 }).notNull().default("section"),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const financePayments = paymentsSchema.table("finance_payments", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  eftRef:      text("eft_ref"),
  billId:      uuid("bill_id").notNull(),
  mode:        varchar("mode", { length: 16 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  utr:         text("utr"),
  ddoCode:     varchar("ddo_code", { length: 12 }),
  paoCode:     varchar("pao_code", { length: 12 }),
  status:      varchar("status", { length: 24 }).notNull().default("initiated"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
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
  submissionStatus: varchar("submission_status", { length: 24 }).notNull().default("pending"),
  status:           varchar("status", { length: 24 }).notNull().default("pending"),
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
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type BillRow    = typeof financeBills.$inferSelect;
export type BillInsert = typeof financeBills.$inferInsert;
export type PaymentRow    = typeof financePayments.$inferSelect;
export type PaymentInsert = typeof financePayments.$inferInsert;
export type AdvanceRow    = typeof financeAdvances.$inferSelect;
export type AdvanceInsert = typeof financeAdvances.$inferInsert;
export type UCRow    = typeof financeUC.$inferSelect;
export type UCInsert = typeof financeUC.$inferInsert;

export const schema = { financeBills, financePayments, financePfms, financeAdvances, financeUC };
