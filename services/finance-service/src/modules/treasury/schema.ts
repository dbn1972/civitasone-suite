import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date, boolean, numeric,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const treasurySchema = pgSchema("treasury");

export const financeBanks = treasurySchema.table("finance_banks", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  name:         text("name").notNull(),
  accountNo:    encryptedText("account_no").notNull(),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  reconciled:   boolean("reconciled").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const financeChallans = treasurySchema.table("finance_challans", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  challanNo:     text("challan_no").notNull(),
  bankAccountId: uuid("bank_account_id"),
  receiptHeadId: uuid("receipt_head_id").notNull(),
  depositor:     text("depositor").notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  grnNo:         text("grn_no"),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  reconciled:    boolean("reconciled").notNull().default(false),
  reconciledLineId: uuid("reconciled_line_id"),
  reconciledAt:  timestamp("reconciled_at", { withTimezone: true }),
  // Cross-service back-link (migration 0070) — the originating record when
  // this challan was created from another service's outbox event (e.g. a
  // municipal licensing application), so "pay the fee for this application"
  // can be joined in either direction. Null for finance-ops-initiated challans.
  sourceService: varchar("source_service", { length: 64 }),
  sourceRef:     text("source_ref"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const financeDeposits = treasurySchema.table("finance_deposits", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  pdNo:         text("pd_no").notNull(),
  type:         varchar("type", { length: 32 }).notNull(),
  administrator: text("administrator").notNull(),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("active"),
  sourceBillId:   uuid("source_bill_id"),
  forfeitedMinor: bigint("forfeited_minor", { mode: "bigint" }).notNull().default(0n),
  refundedMinor:  bigint("refunded_minor", { mode: "bigint" }).notNull().default(0n),
  adjustedMinor:  bigint("adjusted_minor", { mode: "bigint" }).notNull().default(0n),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const financeDepositEvents = treasurySchema.table("finance_deposit_events", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  depositId:   uuid("deposit_id").notNull(),
  eventType:   varchar("event_type", { length: 24 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  reference:   varchar("reference", { length: 128 }),
  journalId:   uuid("journal_id"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export const financeDebt = treasurySchema.table("finance_debt", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  instrument:  text("instrument").notNull(),
  source:      text("source").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  maturity:    date("maturity"),
  // GAP-FINANCE-DEBT-01 (migrations/0082): lender, terms and repayment position.
  lender:           text("lender"),
  interestRateBps:  integer("interest_rate_bps"),
  tenureMonths:     integer("tenure_months"),
  firstEmiDate:     date("first_emi_date"),
  outstandingMinor: bigint("outstanding_minor", { mode: "bigint" }),
  receiptJournalId: uuid("receipt_journal_id"),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

/** One scheduled repayment instalment of a debt instrument (migrations/0082). */
export const financeDebtEmi = treasurySchema.table("finance_debt_emi", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  debtId:         uuid("debt_id").notNull(),
  installmentNo:  integer("installment_no").notNull(),
  dueDate:        date("due_date").notNull(),
  principalMinor: bigint("principal_minor", { mode: "bigint" }).notNull(),
  interestMinor:  bigint("interest_minor", { mode: "bigint" }).notNull(),
  totalMinor:     bigint("total_minor", { mode: "bigint" }).notNull(),
  status:         varchar("status", { length: 8 }).notNull().default("due"),
  paidOn:         date("paid_on"),
  paidBy:         uuid("paid_by"),
  paymentRef:     text("payment_ref"),
  journalId:      uuid("journal_id"),
  version:        integer("version").notNull().default(1),
});

export const financeGuarantees = treasurySchema.table("finance_guarantees", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  entity:      text("entity").notNull(),
  type:        varchar("type", { length: 32 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  feePct:      numeric("fee_pct", { precision: 5, scale: 4 }).notNull().default("0"),
  // GAP-FINANCE-EXPENDITURE-GUARANTEES-01/-02 (migrations/0082).
  validUntil:  date("valid_until"),
  beneficiary: text("beneficiary"),
  linkedRef:   text("linked_ref"),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

/**
 * Cheque / DD payment instruments (Tier-1 residual). Tenant-scoped issuance with
 * a status lifecycle: issued -> presented -> cleared | bounced | cancelled.
 * Money is PAISE bigint. (tenant_id, instrument_type, instrument_no) is unique —
 * that tuple is the idempotency key for issuance.
 */
export const financeInstruments = treasurySchema.table("finance_instruments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  instrumentType: varchar("instrument_type", { length: 8 }).notNull(),
  instrumentNo:   text("instrument_no").notNull(),
  bankAccountId:  uuid("bank_account_id"),
  bankName:       text("bank_name").notNull(),
  payee:          text("payee").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  issueDate:      date("issue_date").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("issued"),
  presentedAt:    timestamp("presented_at", { withTimezone: true }),
  clearedAt:      timestamp("cleared_at", { withTimezone: true }),
  bouncedAt:      timestamp("bounced_at", { withTimezone: true }),
  cancelledAt:    timestamp("cancelled_at", { withTimezone: true }),
  bounceReason:   text("bounce_reason"),
  paymentId:      uuid("payment_id"),
  // Per-transition actors + lifecycle extras (migrations/0085). created_by is the issuer.
  presentedBy:    uuid("presented_by"),
  clearedBy:      uuid("cleared_by"),
  bouncedBy:      uuid("bounced_by"),
  cancelledBy:    uuid("cancelled_by"),
  cancelReason:   text("cancel_reason"),
  representCount: integer("represent_count").notNull().default(0),
  lastRepresentedAt: timestamp("last_represented_at", { withTimezone: true }),
  lastRepresentedBy: uuid("last_represented_by"),
  representReason: text("represent_reason"),
  staledAt:       timestamp("staled_at", { withTimezone: true }),
  staledBy:       uuid("staled_by"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type BankRow      = typeof financeBanks.$inferSelect;
export type ChallanRow   = typeof financeChallans.$inferSelect;
export type ChallanInsert = typeof financeChallans.$inferInsert;
export type DepositRow    = typeof financeDeposits.$inferSelect;
export type DepositInsert = typeof financeDeposits.$inferInsert;
export type DepositEventInsert = typeof financeDepositEvents.$inferInsert;
export type InstrumentRow    = typeof financeInstruments.$inferSelect;
export type InstrumentInsert = typeof financeInstruments.$inferInsert;
export type DebtRow       = typeof financeDebt.$inferSelect;
export type DebtEmiRow    = typeof financeDebtEmi.$inferSelect;
export type GuaranteeRow  = typeof financeGuarantees.$inferSelect;

export const schema = { financeBanks, financeChallans, financeDeposits, financeDepositEvents, financeDebt, financeDebtEmi, financeGuarantees, financeInstruments };
