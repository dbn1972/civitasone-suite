/**
 * LQ-004 — Drizzle schema for per-tenant lifecycle reason codes. Table created via
 * migration 0043. FORCE RLS + tenant policy.
 */
import { pgSchema, uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const leadReasonCodes = crmSchema.table("lead_reason_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 48 }).notNull(),
  label: varchar("label", { length: 160 }).notNull(),
  appliesToStatus: varchar("applies_to_status", { length: 24 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type LeadReasonCodeRow = typeof leadReasonCodes.$inferSelect;

export const schema = { leadReasonCodes };
