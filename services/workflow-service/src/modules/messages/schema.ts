import { pgSchema, uuid, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const messageSubscriptions = domainSchema.table("message_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  taskId: uuid("task_id").notNull(),
  messageName: varchar("message_name", { length: 128 }).notNull(),
  correlationKey: varchar("correlation_key", { length: 256 }).notNull(),
  nodeKey: varchar("node_key", { length: 64 }).notNull(),
  timeoutAt: timestamp("timeout_at", { withTimezone: true }),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  matchedPayload: jsonb("matched_payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signalSubscriptions = domainSchema.table("signal_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  taskId: uuid("task_id").notNull(),
  signalName: varchar("signal_name", { length: 128 }).notNull(),
  nodeKey: varchar("node_key", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MessageSubscriptionRow = typeof messageSubscriptions.$inferSelect;
export type MessageSubscriptionInsert = typeof messageSubscriptions.$inferInsert;

export type SignalSubscriptionRow = typeof signalSubscriptions.$inferSelect;
export type SignalSubscriptionInsert = typeof signalSubscriptions.$inferInsert;

export const schema = { messageSubscriptions, signalSubscriptions };
