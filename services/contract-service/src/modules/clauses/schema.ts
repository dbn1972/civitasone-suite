import { pgSchema, uuid, text, integer, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const clausesSchema = pgSchema("clauses");

export const clauseLibrary = clausesSchema.table("clause_library", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  title:       text("title").notNull(),
  category:    varchar("category", { length: 100 }).notNull(),
  jurisdiction: varchar("jurisdiction", { length: 100 }).notNull(),
  version:     integer("version").notNull().default(1),
  body:        text("body").notNull(),
  mergeFields: jsonb("merge_fields").$type<string[]>().notNull().default([]),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
});

export type ClauseRow = typeof clauseLibrary.$inferSelect;
export type ClauseInsert = typeof clauseLibrary.$inferInsert;

export const schema = { clauseLibrary };
