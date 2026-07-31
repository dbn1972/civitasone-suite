import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

export const agentDefinitions = domainSchema.table("agent_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  skills: jsonb("skills").$type<Record<string, unknown>[]>().notNull().default([]),
  tools: jsonb("tools").$type<Record<string, unknown>[]>().notNull().default([]),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type AgentDefinitionRow = typeof agentDefinitions.$inferSelect;
export type AgentDefinitionInsert = typeof agentDefinitions.$inferInsert;

export const schema = { agentDefinitions };
