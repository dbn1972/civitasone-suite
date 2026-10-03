/**
 * item-links module -- Drizzle schema in Postgres schema `inventory` (migration 0025).
 *
 * A non-destructive cross-reference between an inventory-service item (sku) and a
 * stock-service item (itemCode). At most one link per inventory item and one per
 * stock item (both UNIQUE per tenant). No master row or id is ever rewritten.
 */
import { uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { domainSchema } from "../items/schema.js";

export const itemStockLinks = domainSchema.table("item_stock_links", {
  id:              uuid("id").primaryKey(),
  tenantId:        uuid("tenant_id").notNull(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  stockItemId:     uuid("stock_item_id").notNull(),
  stockItemCode:   varchar("stock_item_code", { length: 64 }).notNull(),
  stockItemName:   varchar("stock_item_name", { length: 256 }).notNull(),
  linkSource:      varchar("link_source", { length: 16 }).notNull().default("manual"),
  linkedBy:        uuid("linked_by").notNull(),
  linkedAt:        timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ItemStockLinkRow = typeof itemStockLinks.$inferSelect;
export type ItemStockLinkInsert = typeof itemStockLinks.$inferInsert;

export const schema = { itemStockLinks };
