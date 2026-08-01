/**
 * collateral module — CR-AI-02 recommendation → sales-collateral linkage.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/**
 * Collateral a rep should use when acting on a recommendation.
 *
 * `collateralRef` is an opaque reference into the owning service (knowledge,
 * catalogue, object storage). No FK: that data lives in another database and
 * cross-schema joins are forbidden by the module-isolation rule.
 */
export const collateralLinks = recommendationSchema.table("collateral_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  recommendationId: uuid("recommendation_id").notNull(),
  /** 'document' | 'video' | 'brochure' | 'case_study' | 'pricing_sheet'. */
  collateralType: varchar("collateral_type", { length: 24 }).notNull(),
  collateralRef: varchar("collateral_ref", { length: 512 }).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  /** Presentation order within a recommendation. Lower shows first. */
  ordinal: integer("ordinal").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CollateralLinkRow = typeof collateralLinks.$inferSelect;
export type CollateralLinkInsert = typeof collateralLinks.$inferInsert;

export const schema = { collateralLinks };
