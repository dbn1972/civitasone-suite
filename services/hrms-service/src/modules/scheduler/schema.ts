import {
  pgSchema, uuid, varchar, integer, date, text, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const schedulerSchema = pgSchema("scheduler");

export const hrmsDueList = schedulerSchema.table("hrms_due_list", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  listKind:      varchar("list_kind", { length: 32 }).notNull(),
  runDate:       date("run_date").notNull().defaultNow(),
  employeeId:    uuid("employee_id").notNull(),
  employeeNo:    text("employee_no"),
  fullName:      text("full_name"),
  dueDate:       date("due_date").notNull(),
  daysRemaining: integer("days_remaining").notNull(),
  details:       jsonb("details").notNull().default({}),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsSchedulerRuns = schedulerSchema.table("hrms_scheduler_runs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  jobName:      varchar("job_name", { length: 48 }).notNull(),
  runDate:      date("run_date").notNull().defaultNow(),
  startedAt:    timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt:   timestamp("finished_at", { withTimezone: true }),
  tenantsSeen:  integer("tenants_seen").notNull().default(0),
  rowsProduced: integer("rows_produced").notNull().default(0),
  status:       varchar("status", { length: 16 }).notNull().default("running"),
  detail:       text("detail"),
});

export type DueListRow = typeof hrmsDueList.$inferSelect;
export type DueListInsert = typeof hrmsDueList.$inferInsert;

export const schema = { hrmsDueList, hrmsSchedulerRuns };
