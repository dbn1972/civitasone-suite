/**
 * composition module — Drizzle schema. Lives in its own Postgres schema `composition`.
 * L2 rule: this module's repo queries ONLY `composition.*`.
 *
 * module_registry / org_profile are GLOBAL platform reference data (no tenant_id,
 * no RLS). tenant_entitlement / tenant_profile are tenant-scoped and FORCE-RLS'd
 * by migration 0025 (tenant_isolation policy).
 */
import { pgSchema, uuid, text, integer, boolean, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";

export const compositionSchema = pgSchema("composition");

export const moduleRegistry = compositionSchema.table("module_registry", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  layer: integer("layer").notNull(),
  isCore: boolean("is_core").notNull().default(false),
  hardDeps: text("hard_deps").array().notNull().$type<string[]>().default([]),
  softDeps: text("soft_deps").array().notNull().$type<string[]>().default([]),
  screens: text("screens").array().notNull().$type<string[]>().default([]),
  cluster: text("cluster").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const moduleBundle = compositionSchema.table("module_bundle", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  moduleIds: text("module_ids").array().notNull().$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const orgProfile = compositionSchema.table("org_profile", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  rulePacks: jsonb("rule_packs").notNull().$type<Record<string, string>>().default({}),
  terminology: jsonb("terminology").notNull().$type<Record<string, string>>().default({}),
  statutory: jsonb("statutory").notNull().$type<Record<string, boolean>>().default({}),
  reservation: boolean("reservation").notNull().default(false),
  defaultModules: text("default_modules").array().notNull().$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const tenantEntitlement = compositionSchema.table(
  "tenant_entitlement",
  {
    tenantId: uuid("tenant_id").notNull(),
    moduleId: text("module_id").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.moduleId] }) }),
);

export const tenantProfile = compositionSchema.table("tenant_profile", {
  tenantId: uuid("tenant_id").primaryKey(),
  profileCode: text("profile_code").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  appliedBy: uuid("applied_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ModuleRegistryRow = typeof moduleRegistry.$inferSelect;
export type OrgProfileRow = typeof orgProfile.$inferSelect;
export type ModuleBundleRow = typeof moduleBundle.$inferSelect;

export const schema = { moduleRegistry, orgProfile, moduleBundle, tenantEntitlement, tenantProfile };
