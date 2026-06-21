import { pgSchema, uuid, varchar, integer, bigint, timestamp, text } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("knowledge");

export const documents = domainSchema.table("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  category: varchar("category", { length: 64 }),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  tags: text("tags").array().notNull().default([]),
  accessLevel: varchar("access_level", { length: 32 }).notNull().default("internal"),
  fileType: varchar("file_type", { length: 64 }),
  fileSize: bigint("file_size", { mode: "number" }),
  author: varchar("author", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentInsert = typeof documents.$inferInsert;

export type DocumentView = {
  id: string;
  tenantId: string;
  title: string;
  category: string | null;
  status: string;
  tags: string[];
  accessLevel: string;
  fileType: string | null;
  fileSize: number | null;
  author: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export const schema = { documents };
