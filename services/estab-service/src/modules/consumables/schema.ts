/**
 * consumables module schema — stationery, office supplies, materials (SVC-061).
 * PG Schema: `consumables`
 */
import {
  pgSchema, uuid, text, varchar, integer, numeric, timestamp,
} from "drizzle-orm/pg-core";

export const consumablesSchema = pgSchema("consumables");

export const consumableItems = consumablesSchema.table("items", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  name:         text("name").notNull(),
  category:     varchar("category", { length: 64 }).notNull().default("stationery"),
  unit:         varchar("unit", { length: 32 }).notNull().default("piece"),
  stockQty:     numeric("stock_qty", { precision: 12, scale: 2 }).notNull().default("0"),
  reorderLevel: numeric("reorder_level", { precision: 12, scale: 2 }).notNull().default("0"),
  status:       varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const consumableTransactions = consumablesSchema.table("transactions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  itemId:    uuid("item_id").notNull(),
  txnType:   varchar("txn_type", { length: 16 }).notNull(),
  qty:       numeric("qty", { precision: 12, scale: 2 }).notNull(),
  refDoc:    text("ref_doc"),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type ConsumableItemRow    = typeof consumableItems.$inferSelect;
export type ConsumableItemInsert = typeof consumableItems.$inferInsert;
export type ConsumableTxnRow     = typeof consumableTransactions.$inferSelect;

export const schema = { consumableItems, consumableTransactions };
