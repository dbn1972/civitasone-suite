/**
 * exports/scheduled-schema.ts — Drizzle table definition for scheduled_exports.
 *
 * Scheduled exports allow tenants to configure recurring export generation
 * at configurable cadences (hourly, daily, weekly, monthly). The cron
 * sweeper checks nextRunAt and publishes export commands for due entries.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

export type ScheduledExportCadence = "hourly" | "daily" | "weekly" | "monthly";

export const scheduledExports = analyticsSchema.table("scheduled_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  queryRunId: uuid("query_run_id").notNull(),
  format: varchar("format", { length: 8 }).notNull().default("csv"), // csv | json
  cadence: varchar("cadence", { length: 16 }).notNull().default("daily"), // hourly | daily | weekly | monthly
  recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ScheduledExportRow = typeof scheduledExports.$inferSelect;
export type ScheduledExportInsert = typeof scheduledExports.$inferInsert;

export const scheduledExportsSchema = { scheduledExports };
