/**
 * settings module — Drizzle schema. Lives in its OWN Postgres schema `settings`.
 * L2 rule: this module's repo queries ONLY `settings.*`.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const settingsSchema = pgSchema("settings");

export const tenantSettings = settingsSchema.table("tenant_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  key: varchar("key", { length: 128 }).notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  // audit columns
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SettingRow = typeof tenantSettings.$inferSelect;
export type SettingInsert = typeof tenantSettings.$inferInsert;

export const schema = { tenantSettings };
