import {
  pgSchema, uuid, text, varchar, integer, timestamp,
} from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const citizenTickets = helpdeskSchema.table("citizen_tickets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  citizenId:   uuid("citizen_id").notNull(),
  subject:     text("subject").notNull(),
  description: text("description").notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("open"),
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

export type TicketRow         = typeof citizenTickets.$inferSelect;
export type TicketInsert      = typeof citizenTickets.$inferInsert;
export type TicketNoteInsert  = typeof citizenTicketNotes.$inferInsert;

export const schema = { citizenTickets, citizenTicketNotes };
