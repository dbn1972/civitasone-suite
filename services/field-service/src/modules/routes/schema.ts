/**
 * routes module — Route planning and optimization schema.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const fieldSchema = pgSchema("field");

/** Route plan — optimized waypoint sequences for field agents. */
export const routePlans = fieldSchema.table("route_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  assigneeId: uuid("assignee_id").notNull(),
  date: date("date").notNull(),
  /** Ordered list of waypoints (lat, lng, taskId, label). */
  waypoints: jsonb("waypoints").$type<Array<Record<string, unknown>>>().notNull().default([]),
  /** Optimized order indices after route calculation. */
  optimizedOrder: jsonb("optimized_order").$type<number[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RoutePlanRow = typeof routePlans.$inferSelect;
export type RoutePlanInsert = typeof routePlans.$inferInsert;

export const schema = { routePlans };
