import { pgSchema, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const knowledgeSchema = pgSchema("knowledge");

export const searchIndex = knowledgeSchema.table("search_index", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  tags: text("tags").array().notNull().default([]),
  status: varchar("status", { length: 24 }).notNull().default("indexed"),
  indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SearchIndexRow = typeof searchIndex.$inferSelect;
export type SearchIndexInsert = typeof searchIndex.$inferInsert;

export type SearchIndexView = {
  id: string;
  tenantId: string;
  documentId: string;
  title: string;
  content: string;
  tags: string[];
  status: string;
  indexedAt: Date;
};

export const schema = { searchIndex };
