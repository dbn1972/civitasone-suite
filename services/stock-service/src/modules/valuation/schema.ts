import {
  pgSchema, uuid, integer, bigint, char, timestamp,
} from "drizzle-orm/pg-core";

export const valuationSchema = pgSchema("valuation");

export const stockValuationRates = valuationSchema.table("stock_valuation_rates", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  itemId:      uuid("item_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  qty:         integer("qty").notNull().default(0),
  rateMinor:   bigint("rate_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:     integer("version").notNull().default(1),
});

export type ValuationRateRow    = typeof stockValuationRates.$inferSelect;
export type ValuationRateInsert = typeof stockValuationRates.$inferInsert;

export const schema = { stockValuationRates };
