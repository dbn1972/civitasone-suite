/**
 * SLA Pauses schema — helpdesk.sla_pauses
 *
 * Records when SLA timers are paused/resumed per ticket status change.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const slaPauses = helpdeskSchema.table("sla_pauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }).notNull().defaultNow(),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  pauseStatus: varchar("pause_status", { length: 64 }).notNull(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SlaPauseRow = typeof slaPauses.$inferSelect;
export type SlaPauseInsert = typeof slaPauses.$inferInsert;

export const schema = { slaPauses };
