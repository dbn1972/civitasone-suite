import { pgSchema, uuid, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const tasks = domainSchema.table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  roleRef: varchar("role_ref", { length: 128 }),
  nodeKey: varchar("node_key", { length: 64 }),
  refType: varchar("ref_type", { length: 64 }),
  refId: uuid("ref_id"),
  decision: varchar("decision", { length: 32 }),
  // P1-1 — per-user assignment. NULL = unassigned (any role-holder may claim).
  assigneeId: uuid("assignee_id"),
  // P1-2 — deemed-approval fire time for timer-node tasks (NULL = not a timer).
  fireAt: timestamp("fire_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  escalationCount: integer("escalation_count").notNull().default(0),
  completedBy: uuid("completed_by"),
  sodOverride: boolean("sod_override").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;

export type TaskView = {
  id: string;
  tenantId: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  nodeKey?: string | null;
  refType?: string | null;
  refId?: string | null;
  decision?: string | null;
  assigneeId?: string | null;
  version: number;
};

export const schema = { tasks };
