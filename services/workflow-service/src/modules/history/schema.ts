import { pgSchema, uuid, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/**
 * Append-only audit of every workflow state change. Rows are immutable by
 * design: a DB trigger (migration 0005) blocks UPDATE/DELETE, so this table is
 * insert-only from the service's perspective.
 */
export const transitionHistory = domainSchema.table("transition_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  taskId: uuid("task_id"),
  fromNode: varchar("from_node", { length: 64 }),
  toNode: varchar("to_node", { length: 64 }),
  action: varchar("action", { length: 32 }).notNull(),
  decision: varchar("decision", { length: 32 }),
  actorId: uuid("actor_id").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransitionRow = typeof transitionHistory.$inferSelect;
export type TransitionInsert = typeof transitionHistory.$inferInsert;

export const schema = { transitionHistory };
