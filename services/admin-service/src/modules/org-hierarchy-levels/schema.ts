/**
 * org_hierarchy_levels module -- Drizzle schema. Lives in its OWN Postgres
 * schema `org_hierarchy_levels` (mirrors feature_flags's one-table-one-schema
 * convention). L2 rule: this module's repo queries ONLY
 * `org_hierarchy_levels.*`.
 *
 * COMP-014: a configurable hierarchy-LEVEL TAXONOMY (how many reporting
 * tiers exist, and each tier's label/description/examples/color) for
 * platform-admin/org-config/OrgConfigPage.tsx. This is NOT the same concept
 * as tenant-service's `org_units` table (actual org-unit INSTANCES, a flat
 * department/division/section/unit/branch taxonomy, consumed by
 * admin/org/OrgHierarchyManager.tsx via GET/POST/PATCH /v1/admin/org-hierarchy,
 * see gap/routes.ts) -- this table and its /v1/admin/org-hierarchy-levels
 * routes are a deliberately distinct path so the two concepts never collide
 * in the API or in code. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md#COMP-014.
 *
 * tenant_id uses this codebase's established sentinel-zero-UUID
 * platform-default convention (statutory.statutory_config migration 0038,
 * payroll.tax_slab_config migration 0039, notification-service migrations
 * 0003/0044/0045): a real tenant_id row is that tenant's own override; the
 * row with tenant_id = '00000000-0000-0000-0000-000000000000' is the
 * platform default, seeded by migration 0033 with exactly the 5 values that
 * used to be hardcoded in OrgConfigPage.tsx's DEFAULT_LEVELS. Resolved
 * per-request by repo.ts's fetchLevelsForTenant(): the tenant's own rows win
 * if any exist, else the platform default's rows.
 */
import { pgSchema, uuid, integer, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const orgHierarchyLevelsPgSchema = pgSchema("org_hierarchy_levels");

export const orgHierarchyLevels = orgHierarchyLevelsPgSchema.table("org_hierarchy_levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), // '00000000-...-000000000000' = platform default
  levelKey: varchar("level_key", { length: 64 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }).notNull().default(""),
  examples: varchar("examples", { length: 500 }).notNull().default(""),
  color: varchar("color", { length: 16 }).notNull().default("#334155"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
}, (t) => ({
  tenantLevelKeyUnique: uniqueIndex("ux_org_hierarchy_levels_tenant_key").on(t.tenantId, t.levelKey),
}));

export type OrgHierarchyLevelRow = typeof orgHierarchyLevels.$inferSelect;
export type OrgHierarchyLevelInsert = typeof orgHierarchyLevels.$inferInsert;

export const schema = { orgHierarchyLevels };
