import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

/**
 * AG-001 multi-agent orchestration run.
 * depth/max_depth and hop_count/max_hops together bound agent recursion —
 * see orchestration-domain.ts#canHandoff for why both are needed.
 */
export const orchestrations = domainSchema.table("orchestrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  rootAgentId: uuid("root_agent_id").notNull(),
  /** one of: running | completed | failed | aborted */
  status: varchar("status", { length: 24 }).notNull().default("running"),
  depth: integer("depth").notNull().default(0),
  maxDepth: integer("max_depth").notNull().default(5),
  hopCount: integer("hop_count").notNull().default(0),
  maxHops: integer("max_hops").notNull().default(20),
  reason: varchar("reason", { length: 500 }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type OrchestrationRow = typeof orchestrations.$inferSelect;
export type OrchestrationInsert = typeof orchestrations.$inferInsert;

/** Append-only handoff trace. Rows are never updated — the trace is evidence. */
export const orchestrationHops = domainSchema.table("orchestration_hops", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  orchestrationId: uuid("orchestration_id").notNull(),
  fromAgentId: uuid("from_agent_id").notNull(),
  toAgentId: uuid("to_agent_id").notNull(),
  depth: integer("depth").notNull().default(0),
  reason: text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type OrchestrationHopRow = typeof orchestrationHops.$inferSelect;
export type OrchestrationHopInsert = typeof orchestrationHops.$inferInsert;

export const schema = { orchestrations, orchestrationHops };
