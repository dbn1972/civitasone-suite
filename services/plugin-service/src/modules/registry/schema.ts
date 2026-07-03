import { pgSchema, uuid, varchar, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

export const registrySchema = pgSchema("registry");

export const plugins = registrySchema.table("plugins", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  manifestJson: jsonb("manifest_json").$type<Record<string, unknown>>().notNull(),
  state: varchar("state", { length: 24 }).notNull().default("uploaded"), // uploaded | installed | enabled | active | disabled | uninstalled
  installedAt: timestamp("installed_at", { withTimezone: true }),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  config: jsonb("config").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PluginRow = typeof plugins.$inferSelect;
export type PluginInsert = typeof plugins.$inferInsert;

export type PluginState = "uploaded" | "installed" | "enabled" | "active" | "disabled" | "uninstalled";

export type PluginView = {
  id: string;
  tenantId: string;
  manifestJson: Record<string, unknown>;
  state: PluginState;
  installedAt: string | null;
  enabledAt: string | null;
  disabledAt: string | null;
  config: Record<string, unknown> | null;
  version: number;
};

export const schema = { plugins };
