/**
 * quotas module — Drizzle schema. Lives in its OWN Postgres schema `quotas`.
 * L2 rule: this module's repo queries ONLY `quotas.*`.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const quotasSchema = pgSchema("quotas");

export const resourceEnum = quotasSchema.enum("quota_resource", [
  "users", "storage_gb", "api_calls_daily", "documents",
]);

export const quotas = quotasSchema.table("quotas", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  resource: resourceEnum("resource").notNull(),
  limit: integer("limit").notNull(),
  used: integer("used").notNull().default(0),
  // audit columns
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type QuotaRow = typeof quotas.$inferSelect;
export type QuotaInsert = typeof quotas.$inferInsert;

export const schema = { quotas };
