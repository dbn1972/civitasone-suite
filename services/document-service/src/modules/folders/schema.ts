import { pgSchema, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("document");

export const folders = domainSchema.table("folders", {
  id:         uuid("id").primaryKey(),
  tenantId:   uuid("tenant_id").notNull(),
  parentId:   uuid("parent_id"),
  name:       varchar("name", { length: 500 }).notNull(),
  path:       varchar("path", { length: 2000 }).notNull().default("/"),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FolderRow    = typeof folders.$inferSelect;
export type FolderInsert = typeof folders.$inferInsert;

export type FolderView = {
  id:        string;
  tenantId:  string;
  parentId:  string | null;
  name:      string;
  path:      string;
  createdAt: Date;
  updatedAt: Date;
};

export const schema = { folders };
