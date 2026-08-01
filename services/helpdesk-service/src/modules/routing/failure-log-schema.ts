/**
 * Routing Failure Log schema — helpdesk.routing_failures
 *
 * Records failed routing attempts for diagnostics and audit.
 */
import { pgSchema, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const routingFailures = helpdeskSchema.table("routing_failures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  attemptedRuleId: uuid("attempted_rule_id"),
  failureReason: text("failure_reason").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoutingFailureRow = typeof routingFailures.$inferSelect;
export type RoutingFailureInsert = typeof routingFailures.$inferInsert;

export const schema = { routingFailures };
