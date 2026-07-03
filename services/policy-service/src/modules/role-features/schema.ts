/**
 * role_features module — Drizzle schema. Lives in its OWN Postgres schema `role_features`.
 * L2 rule: this module's repo queries ONLY `role_features.*`.
 */
import { pgSchema, uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const roleFeaturesSchema = pgSchema("role_features");

export const roleFeatureGrants = roleFeaturesSchema.table("role_feature_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  roleName: varchar("role_name", { length: 100 }).notNull(),
  featureKey: varchar("feature_key", { length: 200 }).notNull(),
  granted: boolean("granted").notNull().default(true),
  grantedBy: uuid("granted_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type RoleFeatureGrantRow = typeof roleFeatureGrants.$inferSelect;
export type RoleFeatureGrantInsert = typeof roleFeatureGrants.$inferInsert;

export const schema = { roleFeatureGrants };
