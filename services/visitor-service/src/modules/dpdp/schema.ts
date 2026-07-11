/**
 * visitor-service: DPDP compliance Drizzle schema.
 *
 * Matches migration 0006_incidents_dpdp_analytics.sql exactly for the
 * consent_log and pii_access_log tables. These are append-only audit tables
 * (no updated_at/version, no application-level UPDATE/DELETE) per the
 * design's "Append-only DPDP audit tables" convention.
 */
import { uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { visitorSchema } from "../blacklist/schema.js";

export const consentLog = visitorSchema.table("consent_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  visitorRef: varchar("visitor_ref", { length: 64 }).notNull(),
  purpose: text("purpose").notNull(),
  dataCollected: jsonb("data_collected").$type<string[]>().notNull().default([]),
  retentionDays: integer("retention_days").notNull().default(365),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const piiAccessLog = visitorSchema.table("pii_access_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  accessorId: uuid("accessor_id").notNull(),
  resourceType: varchar("resource_type", { length: 32 }).notNull(),
  resourceId: uuid("resource_id").notNull(),
  purpose: varchar("purpose", { length: 64 }).notNull(),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConsentLogRow = typeof consentLog.$inferSelect;
export type ConsentLogInsert = typeof consentLog.$inferInsert;
export type PiiAccessLogRow = typeof piiAccessLog.$inferSelect;
export type PiiAccessLogInsert = typeof piiAccessLog.$inferInsert;

export const schema = { consentLog, piiAccessLog };
