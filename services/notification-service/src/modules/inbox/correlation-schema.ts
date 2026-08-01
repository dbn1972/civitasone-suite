/**
 * INT-04: Inbox Correlations — links conversation threads to helpdesk tickets.
 * Table: notification.inbox_correlations
 */
import { pgSchema, uuid, timestamp } from "drizzle-orm/pg-core";

export const inboxSchema = pgSchema("notification");

export const inboxCorrelations = inboxSchema.table("inbox_correlations", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  ticketId:       uuid("ticket_id").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InboxCorrelationRow = typeof inboxCorrelations.$inferSelect;
export type InboxCorrelationInsert = typeof inboxCorrelations.$inferInsert;

export const inboxCorrelationsSchema = { inboxCorrelations };
