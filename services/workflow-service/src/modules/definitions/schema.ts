import { pgSchema, uuid, varchar, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const definitions = domainSchema.table("definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  version: integer("version").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  // Gap 7 — a platform/global template definition that can be cloned into a
  // tenant as a new draft.
  isTemplate: boolean("is_template").notNull().default(false),
  // Visual designer layout metadata
  layout: jsonb("layout").$type<{ width?: number; height?: number; zoom?: number; gridSize?: number }>(),
});

export const definitionNodes = domainSchema.table("definition_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  definitionId: uuid("definition_id").notNull(),
  nodeKey: varchar("node_key", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  roleRef: varchar("role_ref", { length: 128 }),
  nodeType: varchar("node_type", { length: 16 }).notNull().default("task"),
  slaMinutes: integer("sla_minutes"),
  // P1-2 — deemed-approval window (minutes) for a `timer` node. The instance
  // auto-advances along the timer's outgoing edge once this elapses.
  timerMinutes: integer("timer_minutes"),
  // SECURITY C-1/C-3 — opt-in: a `timer` node may auto-approve (deemed
  // approval) ONLY when this is true. Default false => a due timer escalates/
  // notifies but never auto-completes with sodOverride.
  deemedApproval: boolean("deemed_approval").notNull().default(false),
  // Gap 1 — sub-workflow / call-activity. A node_type='call' instantiates a
  // CHILD instance of this active definition code on entry and waits.
  callDefinitionCode: varchar("call_definition_code", { length: 64 }),
  // optional map of parent-context paths -> child-context keys (NULL = pass
  // parent context through unchanged).
  callContextMap: jsonb("call_context_map").$type<Record<string, string>>(),
  // Gap 4 — auto-assignment strategy for a task node: round_robin |
  // least_loaded | hierarchy. NULL/'none' = legacy role-pool (anyone claims).
  assignStrategy: varchar("assign_strategy", { length: 24 }),
  // for 'hierarchy': a reference user whose reporting line we resolve against.
  assignRef: varchar("assign_ref", { length: 128 }),
  // Visual designer position
  positionX: integer("position_x"),
  positionY: integer("position_y"),
  // Message/Signal events
  messageName: varchar("message_name", { length: 128 }),
  correlationKeyExpr: varchar("correlation_key_expr", { length: 256 }),
  signalName: varchar("signal_name", { length: 128 }),
  messageTopic: varchar("message_topic", { length: 128 }),
  messagePayloadExpr: varchar("message_payload_expr", { length: 512 }),
  // Decision tables
  decisionTableCode: varchar("decision_table_code", { length: 64 }),
  // Compensation
  compensationHandlerKey: varchar("compensation_handler_key", { length: 64 }),
  // Multi-instance
  multiInstanceCollection: varchar("multi_instance_collection", { length: 128 }),
  multiInstanceMode: varchar("multi_instance_mode", { length: 16 }),
  multiInstanceCompletion: varchar("multi_instance_completion", { length: 32 }),
  sortOrder: integer("sort_order").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const definitionEdges = domainSchema.table("definition_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  definitionId: uuid("definition_id").notNull(),
  fromNode: varchar("from_node", { length: 64 }).notNull(),
  toNode: varchar("to_node", { length: 64 }).notNull(),
  condition: varchar("condition", { length: 512 }),
  waypoints: jsonb("waypoints").$type<Array<{ x: number; y: number }>>(),
  sortOrder: integer("sort_order").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DefinitionRow = typeof definitions.$inferSelect;
export type DefinitionNodeRow = typeof definitionNodes.$inferSelect;
export type DefinitionEdgeRow = typeof definitionEdges.$inferSelect;

export const schema = { definitions, definitionNodes, definitionEdges };
