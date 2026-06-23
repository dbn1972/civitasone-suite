import {
  pgSchema, uuid, text, varchar, integer, timestamp,
} from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const citizenTickets = helpdeskSchema.table("citizen_tickets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  citizenId:   uuid("citizen_id").notNull(),
  ticketNo:    varchar("ticket_no", { length: 32 }),
  subject:     text("subject").notNull(),
  description: text("description").notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("open"),
  priority:    varchar("priority", { length: 16 }).notNull().default("medium"),
  category:    varchar("category", { length: 64 }).notNull().default("general"),
  channel:     varchar("channel", { length: 24 }).notNull().default("web"),
  ticketType:  varchar("ticket_type", { length: 32 }).notNull().default("grievance"),
  assigneeId:  uuid("assignee_id"),
  slaDueAt:    timestamp("sla_due_at", { withTimezone: true }),
  resolvedAt:  timestamp("resolved_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const citizenTicketNotes = helpdeskSchema.table("citizen_ticket_notes", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  ticketId:  uuid("ticket_id").notNull(),
  authorId:  uuid("author_id").notNull(),
  body:      text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const ticketEscalations = helpdeskSchema.table("ticket_escalations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  ticketId:    uuid("ticket_id").notNull(),
  escalatedBy: uuid("escalated_by").notNull(),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
  reason:      text("reason").notNull(),
  level:       integer("level").notNull().default(1),
});

export type TicketRow         = typeof citizenTickets.$inferSelect;
export type TicketInsert      = typeof citizenTickets.$inferInsert;
export type TicketNoteInsert  = typeof citizenTicketNotes.$inferInsert;
export type EscalationInsert  = typeof ticketEscalations.$inferInsert;

export const schema = { citizenTickets, citizenTicketNotes, ticketEscalations };
