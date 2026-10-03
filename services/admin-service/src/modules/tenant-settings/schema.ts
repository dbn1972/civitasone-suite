/**
 * tenant-settings module — Drizzle schema (migration 0042).
 * Lives in its OWN Postgres schema `tenant_settings`.
 */
import { pgSchema, uuid, varchar, text, jsonb, integer, timestamp, customType } from "drizzle-orm/pg-core";

export const tenantSettingsSchema = pgSchema("tenant_settings");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const settingsSections = tenantSettingsSchema.table("settings_sections", {
  tenantId: uuid("tenant_id").notNull(),
  section: varchar("section", { length: 24 }).notNull(),
  values: jsonb("values").notNull().$type<Record<string, unknown>>().default({}),
  secretCiphertext: text("secret_ciphertext"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
});

export const tenantLogos = tenantSettingsSchema.table("tenant_logos", {
  tenantId: uuid("tenant_id").primaryKey(),
  contentType: varchar("content_type", { length: 32 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  data: bytea("data").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
});

export type SettingsSectionRow = typeof settingsSections.$inferSelect;
export type TenantLogoRow = typeof tenantLogos.$inferSelect;

export const schema = { settingsSections, tenantLogos };
