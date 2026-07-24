import { pgSchema, uuid, varchar, boolean, integer, timestamp, jsonb, time } from "drizzle-orm/pg-core";

export const dndSchema = pgSchema("dnd");

export const dndWindows = dndSchema.table("dnd_windows", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  userId:    uuid("user_id").notNull(),
  startTime: time("start_time").notNull(),
  endTime:   time("end_time").notNull(),
  timezone:  varchar("timezone", { length: 64 }).notNull(),
  days:      jsonb("days").notNull().default(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  enabled:   boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const heldNotifications = dndSchema.table("held_notifications", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  userId:          uuid("user_id").notNull(),
  deliveryPayload: jsonb("delivery_payload").notNull(),
  holdUntil:       timestamp("hold_until", { withTimezone: true }).notNull(),
  status:          varchar("status", { length: 24 }).notNull().default("held"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DndWindowRow = typeof dndWindows.$inferSelect;
export type DndWindowInsert = typeof dndWindows.$inferInsert;
export type HeldNotificationRow = typeof heldNotifications.$inferSelect;
export type HeldNotificationInsert = typeof heldNotifications.$inferInsert;

export const dndModuleSchema = { dndWindows, heldNotifications };
