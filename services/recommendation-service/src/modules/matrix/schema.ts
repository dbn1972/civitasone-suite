/**
 * matrix module — Cross-sell matrix configuration schema.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/** Cross-sell matrix — product-to-product recommendation rules. */
export const crossSellMatrix = recommendationSchema.table("cross_sell_matrix", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  triggerProductId: uuid("trigger_product_id").notNull(),
  recommendedProductId: uuid("recommended_product_id").notNull(),
  segment: varchar("segment", { length: 64 }),
  channel: varchar("channel", { length: 64 }),
  priority: integer("priority").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type CrossSellMatrixRow = typeof crossSellMatrix.$inferSelect;
export type CrossSellMatrixInsert = typeof crossSellMatrix.$inferInsert;

export const schema = { crossSellMatrix };
