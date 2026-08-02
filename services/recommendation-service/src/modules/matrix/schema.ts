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
  /**
   * XS-001 — per-cell weight in BASIS POINTS (0..10000 = 0%..100%).
   *
   * Integer bps, not a float and not money: the value is a ratio used to weight
   * a ranking signal, so it needs exact round-tripping through JSON without the
   * bigint-minor-units convention that money columns use. 1 bps = 0.01%.
   */
  weightBps: integer("weight_bps").notNull().default(0),
  /** XS-001 — cell becomes live at this instant (INCLUSIVE). NULL = live already. */
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  /** XS-001 — cell stops being live at this instant (EXCLUSIVE). NULL = never expires. */
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type CrossSellMatrixRow = typeof crossSellMatrix.$inferSelect;
export type CrossSellMatrixInsert = typeof crossSellMatrix.$inferInsert;

export const schema = { crossSellMatrix };
