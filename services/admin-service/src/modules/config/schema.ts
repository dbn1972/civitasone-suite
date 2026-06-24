import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const configSchema = pgSchema("config");
const PLATFORM = "00000000-0000-0000-0000-000000000000";

export const adminEditions = configSchema.table("admin_editions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  edition: varchar("edition", { length: 32 }).notNull(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const adminModuleConfigs = configSchema.table("admin_module_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  moduleKey: text("module_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const adminFeatureFlags = configSchema.table("admin_feature_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().default(PLATFORM),
  flagKey: text("flag_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  overrides: jsonb("overrides").$type<Record<string, boolean>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  // P0-1: one feature flag row per (tenant, flag_key) so a double-submit of the
  // platform create cannot insert a duplicate row.
  flagKeyUnique: uniqueIndex("admin_feature_flags_tenant_id_flag_key_key").on(t.tenantId, t.flagKey),
}));

export const schema = { adminEditions, adminModuleConfigs, adminFeatureFlags };
