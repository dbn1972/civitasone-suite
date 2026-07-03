import { pgSchema, uuid, varchar, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const hooksSchema = pgSchema("hooks");

export const pluginHooks = hooksSchema.table("plugin_hooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  pluginId: uuid("plugin_id").notNull(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  handlerPath: text("handler_path").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PluginHookRow = typeof pluginHooks.$inferSelect;
export type PluginHookInsert = typeof pluginHooks.$inferInsert;

export type PluginHookView = {
  id: string;
  tenantId: string;
  pluginId: string;
  eventType: string;
  handlerPath: string;
  active: boolean;
  version: number;
};

export const schema = { pluginHooks };
