import { pgSchema, uuid, varchar, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

export const streamSchema = pgSchema("stream");

export const notifications = streamSchema.table("notifications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  userId:    uuid("user_id").notNull(),
  type:      varchar("type", { length: 64 }).notNull(),
  title:     varchar("title", { length: 256 }).notNull(),
  body:      text("body").notNull().default(""),
  metadata:  jsonb("metadata").notNull().default({}),
  readAt:    timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;

export const streamModuleSchema = { notifications };
