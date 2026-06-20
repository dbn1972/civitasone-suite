/**
 * tenant module — Drizzle schema. Lives in its OWN Postgres schema `tenant`.
 * L2 rule: this module's repo queries ONLY `tenant.*`. No other module may import this file.
 */
import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const tenantSchema = pgSchema("tenant");

export const tenants = tenantSchema.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  // tenantId == id for the tenant row itself, but kept for the uniform BaseEntity shape
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  domain: varchar("domain", { length: 253 }).notNull().unique(),
  edition: varchar("edition", { length: 32 }).notNull(), // small_office | psu | govt
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  region: varchar("region", { length: 64 }).notNull(),
  residency: varchar("residency", { length: 64 }).notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  // audit columns (CLAUDE.md §3.6)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TenantRow = typeof tenants.$inferSelect;
export type TenantInsert = typeof tenants.$inferInsert;

export const schema = { tenants };
