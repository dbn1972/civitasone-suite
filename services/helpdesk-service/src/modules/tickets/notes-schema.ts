import { uuid, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { helpdeskSchema } from "./schema.js";

export const ticketNotes = helpdeskSchema.table("ticket_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  content: text("content").notNull(),
  visibility: varchar("visibility", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TicketNoteRow = typeof ticketNotes.$inferSelect;
export type TicketNoteInsert = typeof ticketNotes.$inferInsert;
