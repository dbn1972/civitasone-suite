import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const instances = domainSchema.table("instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  definitionId: uuid("definition_id"),
  definitionVersion: integer("definition_version"),
  refType: varchar("ref_type", { length: 64 }),
  refId: uuid("ref_id"),
  currentNode: varchar("current_node", { length: 64 }),
  // Gap 1 — sub-workflow linkage: a CHILD instance records its parent so the
  // child reaching a terminal state can resume the parent.
  parentInstanceId: uuid("parent_instance_id"),
  parentTaskId: uuid("parent_task_id"),
  parentNodeKey: varchar("parent_node_key", { length: 64 }),
  // SECURITY C1 — call-activity nesting depth. Root = 0; a call-node child is
  // parent.call_depth + 1. Used to reject fork-bombs past WORKFLOW_MAX_CALL_DEPTH.
  callDepth: integer("call_depth").notNull().default(0),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  completedNodes: jsonb("completed_nodes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type InstanceRow = typeof instances.$inferSelect;
export type InstanceInsert = typeof instances.$inferInsert;

export type InstanceView = {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  definitionId?: string | null;
  refType?: string | null;
  refId?: string | null;
  currentNode?: string | null;
  version: number;
};

export const schema = { instances };
