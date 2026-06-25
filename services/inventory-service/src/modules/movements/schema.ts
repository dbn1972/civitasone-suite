/**
 * movements module — the stock-movement write model (CQRS).
 *
 *   movements        : header for a receipt / issue / transfer / adjustment
 *   movementLines    : per-item lines of a movement (qty + rate in paise)
 *   stockBalances    : current on-hand qty + weighted-average rate per (item, store)
 *   stockLedger      : append-only audit trail of every quantity change
 *   reasonCodes      : controlled vocabulary for adjustments / write-offs
 *
 * All money is stored in paise (minor units) as bigint. Every table is
 * tenant-scoped; mutable tables carry a `version` column for optimistic locking.
 */
import { pgSchema, uuid, varchar, integer, bigint, char, date, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const reasonCodes = domainSchema.table("reason_codes", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  code:        varchar("code", { length: 32 }).notNull(),
  description: varchar("description", { length: 200 }).notNull(),
  kind:        varchar("kind", { length: 16 }).notNull().default("adjustment"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export const movements = domainSchema.table("movements", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  movementType: varchar("movement_type", { length: 16 }).notNull(),
  refDoc:       varchar("ref_doc", { length: 64 }),
  refNo:        varchar("ref_no", { length: 64 }),
  postingDate:  date("posting_date").notNull(),
  fromStoreId:  uuid("from_store_id"),
  toStoreId:    uuid("to_store_id"),
  reasonCode:   varchar("reason_code", { length: 32 }),
  notes:        varchar("notes", { length: 512 }),
  status:       varchar("status", { length: 16 }).notNull().default("posted"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const movementLines = domainSchema.table("movement_lines", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  movementId:  uuid("movement_id").notNull(),
  itemId:      uuid("item_id").notNull(),
  qty:         integer("qty").notNull(),
  rateMinor:   bigint("rate_minor", { mode: "bigint" }).notNull().default(0n),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockBalances = domainSchema.table("stock_balances", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  itemId:      uuid("item_id").notNull(),
  storeId:     uuid("store_id").notNull(),
  onHandQty:   integer("on_hand_qty").notNull().default(0),
  avgRateMinor: bigint("avg_rate_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:     integer("version").notNull().default(1),
});

export const stockLedger = domainSchema.table("stock_ledger", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  itemId:       uuid("item_id").notNull(),
  storeId:      uuid("store_id").notNull(),
  movementId:   uuid("movement_id").notNull(),
  movementType: varchar("movement_type", { length: 16 }).notNull(),
  qtyIn:        integer("qty_in").notNull().default(0),
  qtyOut:       integer("qty_out").notNull().default(0),
  balanceQty:   integer("balance_qty").notNull(),
  rateMinor:    bigint("rate_minor", { mode: "bigint" }).notNull().default(0n),
  valueMinor:   bigint("value_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  reasonCode:   varchar("reason_code", { length: 32 }),
  postingDate:  date("posting_date").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export type ReasonCodeRow   = typeof reasonCodes.$inferSelect;
export type MovementRow     = typeof movements.$inferSelect;
export type MovementInsert  = typeof movements.$inferInsert;
export type MovementLineInsert = typeof movementLines.$inferInsert;
export type StockBalanceRow = typeof stockBalances.$inferSelect;
export type LedgerRow       = typeof stockLedger.$inferSelect;
export type LedgerInsert    = typeof stockLedger.$inferInsert;

export const schema = { reasonCodes, movements, movementLines, stockBalances, stockLedger };
