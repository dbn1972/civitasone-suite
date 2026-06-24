import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const backupSchema = pgSchema("backup");

export const adminBackupSchedules = backupSchema.table("admin_backup_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  cronExpr: text("cron_expr").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const adminBackupRuns = backupSchema.table("admin_backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  scheduleId: uuid("schedule_id"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  restorePoint: text("restore_point"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  // P0-1: at most one in-flight backup per tenant. A double-submit of a backup
  // run that races past the messageId dedupe is backstopped by this partial
  // unique index.
  oneRunning: uniqueIndex("admin_backup_runs_one_running_per_tenant")
    .on(t.tenantId)
    .where(sql`status = 'running'`),
}));

export type AdminBackupScheduleInsert = typeof adminBackupSchedules.$inferInsert;
export type AdminBackupRunInsert = typeof adminBackupRuns.$inferInsert;
export const schema = { adminBackupSchedules, adminBackupRuns };
