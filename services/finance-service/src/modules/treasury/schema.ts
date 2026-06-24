import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date, boolean, numeric,
} from "drizzle-orm/pg-core";

export const treasurySchema = pgSchema("treasury");

export const financeBanks = treasurySchema.table("finance_banks", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  name:         text("name").notNull(),
  accountNo:    text("account_no").notNull(),
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
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const financeGuarantees = treasurySchema.table("finance_guarantees", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  entity:      text("entity").notNull(),
  type:        varchar("type", { length: 32 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  feePct:      numeric("fee_pct", { precision: 5, scale: 4 }).notNull().default("0"),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type BankRow      = typeof financeBanks.$inferSelect;
export type ChallanRow   = typeof financeChallans.$inferSelect;
export type ChallanInsert = typeof financeChallans.$inferInsert;
export type DepositRow    = typeof financeDeposits.$inferSelect;
export type DepositInsert = typeof financeDeposits.$inferInsert;
export type DepositEventInsert = typeof financeDepositEvents.$inferInsert;

export const schema = { financeBanks, financeChallans, financeDeposits, financeDepositEvents, financeDebt, financeGuarantees };
