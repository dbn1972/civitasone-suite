/**
 * products module — Drizzle schema. 4-level product hierarchy with lifecycle management.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

export const products = catalogueSchema.table("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 2000 }),
  /** Level 1 grouping — product line (e.g. "Savings", "Loans", "Insurance"). */
  lineId: uuid("line_id"),
  /** Level 2 grouping — product family within a line. */
  familyId: uuid("family_id"),
  /** Level 3/4 — direct parent for sub-products / variants. */
  parentId: uuid("parent_id"),
  lifecycleStatus: varchar("lifecycle_status", { length: 32 }).notNull().default("draft"),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  regulatoryMetadata: jsonb("regulatory_metadata").$type<Record<string, unknown>>().notNull().default({}),
  /** QP-001: human-facing catalogue code, unique per tenant (migration 0005). */
  productCode: varchar("product_code", { length: 64 }),
  /** QP-001: catalogue category label. */
  category: varchar("category", { length: 100 }),
  /**
   * QP-001: tax rate in BASIS POINTS as an INTEGER (1200 = 12.00%).
   * Basis points keep the rate exact — a float percentage would drift.
   */
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProductRow = typeof products.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;

export const productAvailability = catalogueSchema.table("product_availability", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  circleId: uuid("circle_id"),
  regionId: uuid("region_id"),
  officeId: uuid("office_id"),
  available: integer("available").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProductAvailabilityRow = typeof productAvailability.$inferSelect;
export type ProductAvailabilityInsert = typeof productAvailability.$inferInsert;

export const schema = { products, productAvailability };
