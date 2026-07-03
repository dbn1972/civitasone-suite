import { pgSchema, uuid, varchar, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

export const templatesSchema = pgSchema("templates");

export const templates = templatesSchema.table("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  type: varchar("type", { length: 24 }).notNull(), // email | letter | certificate
  name: varchar("name", { length: 256 }).notNull(),
  htmlBody: text("html_body").notNull(),
  variables: jsonb("variables").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TemplateRow = typeof templates.$inferSelect;
export type TemplateInsert = typeof templates.$inferInsert;

export type TemplateView = {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  htmlBody: string;
  variables: Record<string, string> | null;
  version: number;
};

export const schema = { templates };
