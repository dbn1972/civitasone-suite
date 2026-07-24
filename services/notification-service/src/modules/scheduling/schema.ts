import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const schedulingSchema = pgSchema("scheduling");

export const scheduledNotifications = schedulingSchema.table("scheduled_notifications", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  templateId:  uuid("template_id").notNull(),
  recipient:   varchar("recipient", { length: 254 }).notNull(),
  recipientId: uuid("recipient_id"),
  channel:     varchar("channel", { length: 32 }).notNull(),
  priority:    varchar("priority", { length: 16 }).notNull().default("normal"),
  variables:   jsonb("variables").notNull().default({}),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("scheduled"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type ScheduledNotificationRow = typeof scheduledNotifications.$inferSelect;
export type ScheduledNotificationInsert = typeof scheduledNotifications.$inferInsert;

export const schedulingModuleSchema = { scheduledNotifications };
