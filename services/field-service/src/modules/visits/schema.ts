/**
 * visits module — Visit log schema for field check-in/check-out.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text, numeric } from "drizzle-orm/pg-core";

export const fieldSchema = pgSchema("field");

/** Visit log — GPS-verified check-in/check-out records. */
export const visits = fieldSchema.table("visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  taskId: uuid("task_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  /** Check-in GPS coordinates. */
  checkInLatitude: numeric("check_in_latitude", { precision: 10, scale: 7 }),
  checkInLongitude: numeric("check_in_longitude", { precision: 10, scale: 7 }),
  /** Check-out GPS coordinates. */
  checkOutLatitude: numeric("check_out_latitude", { precision: 10, scale: 7 }),
  checkOutLongitude: numeric("check_out_longitude", { precision: 10, scale: 7 }),
  checkInAt: timestamp("check_in_at", { withTimezone: true }),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  /** Duration in minutes (computed on check-out). */
  durationMinutes: integer("duration_minutes"),
  /** Visit outcome classification. */
  outcome: varchar("outcome", { length: 24 }),
  notes: text("notes"),
  /** Array of photo URLs/keys captured during visit. */
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type VisitRow = typeof visits.$inferSelect;
export type VisitInsert = typeof visits.$inferInsert;

export const schema = { visits };
