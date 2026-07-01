import {
  pgSchema, uuid, text, integer, bigint, char, varchar, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

export const simplifiedSchema = pgSchema("simplified");

/** Flat chart of accounts for MSME / Small Office tenants. */
export const simplifiedAccounts = simplifiedSchema.table("accounts", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  code:       varchar("code", { length: 8 }).notNull(),
  name:       text("name").notNull(),
  category:   varchar("category", { length: 24 }).notNull(), // income | expense | asset | liability
  parentCode: varchar("parent_code", { length: 8 }),
  isGroup:    boolean("is_group").notNull().default(false),
  active:     boolean("active").notNull().default(true),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

/** User-friendly transaction record (maps 1:1 to a GL journal under the hood). */
export const simplifiedTransactions = simplifiedSchema.table("transactions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  type:          varchar("type", { length: 32 }).notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull(),
  gstMinor:      bigint("gst_minor", { mode: "bigint" }).notNull().default(0n),
  totalMinor:    bigint("total_minor", { mode: "bigint" }).notNull(),
  accountCode:   varchar("account_code", { length: 8 }).notNull(),
  counterParty:  text("counter_party"),
  description:   text("description"),
  invoiceNo:     text("invoice_no"),
  journalId:     uuid("journal_id"),
  postingDate:   date("posting_date").notNull(),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type SimplifiedAccountRow = typeof simplifiedAccounts.$inferSelect;
export type SimplifiedAccountInsert = typeof simplifiedAccounts.$inferInsert;
export type SimplifiedTransactionRow = typeof simplifiedTransactions.$inferSelect;
export type SimplifiedTransactionInsert = typeof simplifiedTransactions.$inferInsert;

export const schema = { simplifiedAccounts, simplifiedTransactions };
