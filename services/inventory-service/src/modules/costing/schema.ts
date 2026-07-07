/**
 * costing module — Drizzle schema for FIFO/WAVG cost layers.
 *
 * Each receipt creates a cost layer tracking the quantity received, remaining
 * quantity available for consumption, and the unit cost in paise (bigint).
 * Issues consume layers in receipt-date order (FIFO) or at the running
 * weighted-average rate (WAVG) depending on the item's valuation method.
 *
 * All money is stored as bigint paise. Every table is tenant-scoped with
 * optimistic locking via `version`.
 */
import { pgSchema, uuid, varchar, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const costLayers = domainSchema.table("cost_layers", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  itemId:         uuid("item_id").notNull(),
  warehouseId:    uuid("warehouse_id").notNull(),
  receiptDate:    timestamp("receipt_date", { withTimezone: true }).notNull(),
  qty:            integer("qty").notNull(),
  remainingQty:   integer("remaining_qty").notNull(),
  unitCostPaise:  bigint("unit_cost_paise", { mode: "bigint" }).notNull(),
  receiptId:      uuid("receipt_id"),
  createdBy:      uuid("created_by").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type CostLayerRow = typeof costLayers.$inferSelect;
export type CostLayerInsert = typeof costLayers.$inferInsert;

export const schema = { costLayers };
