/**
 * tasks module — Drizzle schema for field tasks.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text, numeric } from "drizzle-orm/pg-core";

export const fieldSchema = pgSchema("field");

/** Field tasks — assignments for field agents. */
export const tasks = fieldSchema.table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  assigneeId: uuid("assignee_id"),
  taskType: varchar("task_type", { length: 64 }).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 24 }).notNull().default("unassigned"),
  priority: integer("priority").notNull().default(3),
  /** GPS target location. */
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  address: text("address"),
  /** Due date/time for SLA tracking. */
  dueDate: timestamp("due_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  /** Extra metadata. */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;

export const schema = { tasks };
