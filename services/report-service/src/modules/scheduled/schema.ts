/**
 * scheduled module — Drizzle schema for scheduled_reports in `reports` Postgres schema.
 * Supports cron-triggered report generation with delivery to recipients.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("reports");

export type ScheduledReportCadence = "hourly" | "daily" | "weekly" | "monthly";

export const scheduledReports = domainSchema.table("scheduled_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  templateId: uuid("template_id").notNull(),
  cadence: varchar("cadence", { length: 16 }).notNull().default("daily"),
  recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  format: varchar("format", { length: 8 }).notNull().default("pdf"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ScheduledReportRow = typeof scheduledReports.$inferSelect;
export type ScheduledReportInsert = typeof scheduledReports.$inferInsert;

export const scheduledReportsSchema = { scheduledReports };
