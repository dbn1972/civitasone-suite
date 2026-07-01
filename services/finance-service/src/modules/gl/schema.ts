import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date, jsonb,
} from "drizzle-orm/pg-core";

export const glSchema = pgSchema("gl");

/**
 * H3: amounts are paise and may exceed 2^53, so they are carried as bigint
 * (or a string/number that converts to bigint without loss). Convert with
 * BigInt(...) before arithmetic or persistence — never Number().
 */
export type MinorAmount = bigint | number | string;

export type JournalLine = {
  accountCode: string;
  debitMinor:  MinorAmount;
  creditMinor: MinorAmount;
  narration?:  string;
};

export const financeJournals = glSchema.table("finance_journals", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  voucherNo:   text("voucher_no").notNull(),
  type:        varchar("type", { length: 32 }).notNull(),
  postingDate: date("posting_date").notNull(),
  lines:       jsonb("lines").$type<JournalLine[]>().notNull().default([]),
  status:      varchar("status", { length: 24 }).notNull().default("draft"),
  // ERP org structure references (0028)
  legalEntityId:  uuid("legal_entity_id"),
  costCenterId:   uuid("cost_center_id"),
  profitCenterId: uuid("profit_center_id"),
  operatingUnitId: uuid("operating_unit_id"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
  reversesId:  uuid("reverses_id"),
});

export const financeLedger = glSchema.table("finance_ledger", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  headId:      uuid("head_id").notNull(),
  debitMinor:  bigint("debit_minor", { mode: "bigint" }).notNull().default(0n),
  creditMinor: bigint("credit_minor", { mode: "bigint" }).notNull().default(0n),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull().default(0n),
  voucherNo:   text("voucher_no").notNull(),
  postingDate: date("posting_date").notNull(),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type JournalRow  = typeof financeJournals.$inferSelect;
export type JournalInsert = typeof financeJournals.$inferInsert;
export type LedgerRow   = typeof financeLedger.$inferSelect;
export type LedgerInsert = typeof financeLedger.$inferInsert;

export const schema = { financeJournals, financeLedger };
