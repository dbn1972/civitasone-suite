/**
 * tasks module — Drizzle schema for field tasks.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const fieldSchema = pgSchema("field");

/** Field tasks — assignments for field agents. */
export const tasks = fieldSchema.table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  assigneeId: uuid("assignee_id").notNull(),
  taskType: varchar("task_type", { length: 64 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  /** GPS location details as JSON (lat, lng, address, etc.). */
  location: jsonb("location").$type<Record<string, unknown>>(),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;

export const schema = { tasks };
