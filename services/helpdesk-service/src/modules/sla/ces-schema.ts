/**
 * CES (Customer Effort Score) schema — helpdesk.ces_responses
 *
 * Captures CES survey data (1–7 scale) with frequency caps:
 * - Max 1 per ticket
 * - Max 3 per customer per 30 days
 */
import { pgSchema, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const cesResponses = helpdeskSchema.table("ces_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  effortScore: integer("effort_score").notNull(),
  comment: text("comment"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type CesResponseRow = typeof cesResponses.$inferSelect;
export type CesResponseInsert = typeof cesResponses.$inferInsert;

export const schema = { cesResponses };
