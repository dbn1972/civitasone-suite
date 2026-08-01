import { uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { helpdeskSchema } from "./schema.js";

export const ticketLinks = helpdeskSchema.table("ticket_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  sourceTicketId: uuid("source_ticket_id").notNull(),
  targetTicketId: uuid("target_ticket_id").notNull(),
  linkType: varchar("link_type", { length: 24 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type TicketLinkRow = typeof ticketLinks.$inferSelect;
export type TicketLinkInsert = typeof ticketLinks.$inferInsert;
