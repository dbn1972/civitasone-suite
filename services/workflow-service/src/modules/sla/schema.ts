import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-027 — a tenant working calendar (business hours + holidays). */
export const workingCalendars = domainSchema.table("working_calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  workweek: jsonb("workweek").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  holidays: jsonb("holidays").$type<string[]>().notNull().default([]),
  workStartMinute: integer("work_start_minute").notNull().default(540),
  workEndMinute: integer("work_end_minute").notNull().default(1020),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** CAP-027 — a pause interval on a task's SLA clock. */
export const taskSlaPauses = domainSchema.table("task_sla_pauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  taskId: uuid("task_id").notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }).notNull().defaultNow(),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  reason: varchar("reason", { length: 256 }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkingCalendarRow = typeof workingCalendars.$inferSelect;
export type TaskSlaPauseRow = typeof taskSlaPauses.$inferSelect;

export const schema = { workingCalendars, taskSlaPauses };
