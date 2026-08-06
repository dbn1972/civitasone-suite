import { pgSchema, uuid, varchar, integer, timestamp, text, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const agentScripts = crmSchema.table("agent_scripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productCode: varchar("product_code", { length: 120 }).notNull(),
  language: varchar("language", { length: 10 }).notNull(),
  scriptKey: varchar("script_key", { length: 64 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  status: varchar("status", { length: 12 }).notNull().default("draft"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AgentScriptRow = typeof agentScripts.$inferSelect;
export type AgentScriptInsert = typeof agentScripts.$inferInsert;

export type AgentScriptView = {
  id: string;
  tenantId: string;
  productCode: string;
  language: string;
  scriptKey: string;
  title: string;
  body: string;
  versionNumber: number;
  status: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
};

export const schema = { agentScripts };
