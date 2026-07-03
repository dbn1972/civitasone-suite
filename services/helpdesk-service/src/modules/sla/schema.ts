import { pgSchema, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const ticketEscalations = helpdeskSchema.table("ticket_escalations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  ticketId:    uuid("ticket_id").notNull(),
  escalatedBy: uuid("escalated_by").notNull(),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
  reason:      text("reason").notNull(),
  level:       integer("level").notNull().default(1),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
});

export const schema = { ticketEscalations };
