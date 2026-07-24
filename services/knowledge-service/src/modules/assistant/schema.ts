import { pgSchema, uuid, varchar, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("knowledge");

export const faqs = domainSchema.table("faqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  question: varchar("question", { length: 500 }).notNull(),
  answer: text("answer").notNull(),
  category: varchar("category", { length: 64 }),
  tags: text("tags").array().notNull().default([]),
  status: varchar("status", { length: 16 }).notNull().default("published"),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const guidedFlows = domainSchema.table("guided_flows", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  category: varchar("category", { length: 64 }),
  steps: jsonb("steps").$type<FlowStepRow[]>().notNull().default([]),
  status: varchar("status", { length: 16 }).notNull().default("published"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const assistantInteractions = domainSchema.table("assistant_interactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  question: varchar("question", { length: 1000 }).notNull(),
  answer: text("answer"),
  answered: boolean("answered").notNull().default(false),
  escalated: boolean("escalated").notNull().default(false),
  citations: jsonb("citations").$type<CitationRow[]>().notNull().default([]),
  ticketRef: uuid("ticket_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type FlowStepRow = { order: number; title: string; instruction: string };
export type CitationRow = { docId: string; title: string; source: string };

export type FaqRow = typeof faqs.$inferSelect;
export type FaqInsert = typeof faqs.$inferInsert;
export type FlowRow = typeof guidedFlows.$inferSelect;
export type FlowInsert = typeof guidedFlows.$inferInsert;
export type InteractionRow = typeof assistantInteractions.$inferSelect;
export type InteractionInsert = typeof assistantInteractions.$inferInsert;

export const schema = { faqs, guidedFlows, assistantInteractions };
