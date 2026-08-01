/**
 * SLA Extensions schema — helpdesk.sla_extensions
 *
 * Records approved SLA deadline extensions for tickets.
 */
import { pgSchema, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const slaExtensions = helpdeskSchema.table("sla_extensions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  additionalMinutes: integer("additional_minutes").notNull(),
  reason: text("reason").notNull(),
  approverId: uuid("approver_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SlaExtensionRow = typeof slaExtensions.$inferSelect;
export type SlaExtensionInsert = typeof slaExtensions.$inferInsert;

export const schema = { slaExtensions };
