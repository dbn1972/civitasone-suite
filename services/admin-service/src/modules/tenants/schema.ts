import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const tenantsSchema = pgSchema("tenants");

export const adminTenants = tenantsSchema.table("admin_tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  domain: varchar("domain", { length: 253 }).notNull().unique(),
  edition: varchar("edition", { length: 32 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  region: varchar("region", { length: 64 }).notNull(),
  residency: varchar("residency", { length: 64 }).notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdminTenantRow = typeof adminTenants.$inferSelect;
export type AdminTenantInsert = typeof adminTenants.$inferInsert;
export const schema = { adminTenants };
