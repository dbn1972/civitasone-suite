/**
 * scheduled_jobs module — Drizzle schema. Lives in its OWN Postgres schema `scheduled_jobs`.
 * L2 rule: this module's repo queries ONLY `scheduled_jobs.*`.
 */
import { pgSchema, uuid, varchar, text, boolean, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const scheduledJobsSchema = pgSchema("scheduled_jobs");

export const jobStatusEnum = scheduledJobsSchema.enum("job_run_status", [
  "success", "failed", "running", "never_run",
]);

export const scheduledJobs = scheduledJobsSchema.table("scheduled_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description").notNull().default(""),
  cronExpression: varchar("cron_expression", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 50 }).notNull().default("Asia/Kolkata"),
  targetService: varchar("target_service", { length: 100 }).notNull(),
  targetCommand: varchar("target_command", { length: 200 }).notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>().default({}),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunStatus: jobStatusEnum("last_run_status").notNull().default("never_run"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const jobExecutionHistory = scheduledJobsSchema.table("job_execution_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  jobId: uuid("job_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  status: jobStatusEnum("status").notNull().default("running"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScheduledJobRow = typeof scheduledJobs.$inferSelect;
export type ScheduledJobInsert = typeof scheduledJobs.$inferInsert;
export type JobExecutionRow = typeof jobExecutionHistory.$inferSelect;

export const schema = { scheduledJobs, jobExecutionHistory };
