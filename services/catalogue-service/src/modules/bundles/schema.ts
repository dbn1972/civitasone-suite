/**
 * bundles module — Drizzle schema. Product bundles for combined offerings.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

export const bundles = catalogueSchema.table("bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 2000 }),
  componentProductIds: jsonb("component_product_ids").$type<string[]>().notNull().default([]),
  pricingApprovalRequired: boolean("pricing_approval_required").notNull().default(false),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BundleRow = typeof bundles.$inferSelect;
export type BundleInsert = typeof bundles.$inferInsert;

export const schema = { bundles };
