import { pgSchema, uuid, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";


export const knowledgeSchema = pgSchema("knowledge");

export const categories = knowledgeSchema.table("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parentId: uuid("parent_id"),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  icon: varchar("icon", { length: 64 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CategoryRow = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;

export type CategoryView = {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  version: number;
  children?: CategoryView[];
};

export const schema = { categories };
