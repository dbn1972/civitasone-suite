/**
 * Hold Queue schema — helpdesk.hold_queue
 *
 * Stores tickets waiting for agent assignment when no agent is available.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const holdQueue = helpdeskSchema.table("hold_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  queueName: varchar("queue_name", { length: 128 }).notNull().default("default"),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  priority: integer("priority").notNull().default(0),
  version: integer("version").notNull().default(1),
});

export type HoldQueueRow = typeof holdQueue.$inferSelect;
export type HoldQueueInsert = typeof holdQueue.$inferInsert;

export const schema = { holdQueue };
