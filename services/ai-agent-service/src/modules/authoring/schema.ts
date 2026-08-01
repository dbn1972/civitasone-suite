import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

/**
 * AG-003 no-code authored agent definitions (draft → published → archived).
 *
 * Separate from ai_agent.agent_definitions (the runtime registry, status
 * active|paused|archived) because the two lifecycles are different and the
 * runtime table already carries live rows — see migration 0002 header.
 */
export const agentAuthoringDefinitions = domainSchema.table("agent_authoring_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull().default(""),
  tools: jsonb("tools").$type<Record<string, unknown>[]>().notNull().default([]),
  modelConfig: jsonb("model_config").$type<Record<string, unknown>>().notNull().default({}),
  /** one of: draft | published | archived */
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AuthoringDefinitionRow = typeof agentAuthoringDefinitions.$inferSelect;
export type AuthoringDefinitionInsert = typeof agentAuthoringDefinitions.$inferInsert;

export const schema = { agentAuthoringDefinitions };
