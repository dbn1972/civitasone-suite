import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text, boolean } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

/**
 * F.4 governed tool catalogue. `requiresApproval` is the governance boundary —
 * see tools/domain.ts#decideReactStep.
 */
export const toolDefinitions = domainSchema.table("tool_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** one of: crm | helpdesk | finance | hrms | generic */
  agentDomain: varchar("agent_domain", { length: 24 }).notNull(),
  toolName: varchar("tool_name", { length: 120 }).notNull(),
  description: text("description"),
  inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().notNull().default({}),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ToolDefinitionRow = typeof toolDefinitions.$inferSelect;
export type ToolDefinitionInsert = typeof toolDefinitions.$inferInsert;

/**
 * F.4 ReAct reasoning trace (append-only). `executed = false` with status
 * 'pending_approval' is the governed state: the agent proposed the action, a
 * human still has to authorise it.
 */
export const reactSteps = domainSchema.table("react_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  orchestrationId: uuid("orchestration_id"),
  toolId: uuid("tool_id"),
  stepNo: integer("step_no").notNull().default(1),
  thought: text("thought").notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  actionInput: jsonb("action_input").$type<Record<string, unknown>>().notNull().default({}),
  observation: text("observation"),
  /** one of: executed | pending_approval | rejected */
  status: varchar("status", { length: 24 }).notNull().default("executed"),
  executed: boolean("executed").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ReactStepRow = typeof reactSteps.$inferSelect;
export type ReactStepInsert = typeof reactSteps.$inferInsert;

export const schema = { toolDefinitions, reactSteps };
