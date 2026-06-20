import {
  pgSchema, uuid, integer, bigint, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const ledgerSchema = pgSchema("ledger");

export const stockLedger = ledgerSchema.table("stock_ledger", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  itemId:      uuid("item_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  entryId:     uuid("entry_id").notNull(),
  voucherType: varchar("voucher_type", { length: 16 }).notNull(),
  qtyIn:       integer("qty_in").notNull().default(0),
  qtyOut:      integer("qty_out").notNull().default(0),
  balanceQty:  integer("balance_qty").notNull(),
  rateMinor:   bigint("rate_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  postingDate: date("posting_date").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  // append-only: no updatedAt / updatedBy
});

export type LedgerRow    = typeof stockLedger.$inferSelect;
export type LedgerInsert = typeof stockLedger.$inferInsert;

export const schema = { stockLedger };
