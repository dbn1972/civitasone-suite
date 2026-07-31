/**
 * visits module — Visit log schema for field check-in/check-out.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const fieldSchema = pgSchema("field");

/** Visit log — GPS-verified check-in/check-out records. */
export const visits = fieldSchema.table("visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  taskId: uuid("task_id").notNull(),
  checkInAt: timestamp("check_in_at", { withTimezone: true }),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  /** GPS location at time of visit (lat, lng, accuracy). */
  location: jsonb("location").$type<Record<string, unknown>>(),
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
