import { pgSchema, uuid, integer, bigint, char, timestamp } from "drizzle-orm/pg-core";

export const receiptSchema = pgSchema("entry");

export const stockReceipts = receiptSchema.table("stock_receipts", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  itemId:       uuid("item_id").notNull(),
  warehouseId:  uuid("warehouse_id").notNull(),
  entryId:      uuid("entry_id"),
  quantity:     integer("quantity").notNull(),
  remainingQty: integer("remaining_qty").notNull(),
  unitCostMinor: bigint("unit_cost_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { stockReceipts };
