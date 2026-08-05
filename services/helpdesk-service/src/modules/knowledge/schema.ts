import { uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { helpdeskSchema } from "../tickets/schema.js";

export const ticketKnowledgeLinks = helpdeskSchema.table("ticket_knowledge_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  articleId: uuid("article_id").notNull(),
  articleTitle: varchar("article_title", { length: 200 }).notNull(),
  linkedBy: uuid("linked_by").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicketKnowledgeLinkRow = typeof ticketKnowledgeLinks.$inferSelect;
export type TicketKnowledgeLinkInsert = typeof ticketKnowledgeLinks.$inferInsert;

export const knowledgeSchema = { ticketKnowledgeLinks };
