import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/**
 * BPMN 2.0 visual designer definitions.
 * Stores canvas state: positioned nodes (BPMN elements) and edges (sequence flows).
 * Max 500 elements (nodes + edges) per definition enforced at route level.
 */

/** A node on the BPMN designer canvas. */
export interface DesignerNode {
  id: string;
  type: string; // startEvent | endEvent | userTask | serviceTask | exclusiveGateway | parallelGateway | intermediateEvent
  label: string;
  position: { x: number; y: number };
  properties?: Record<string, unknown>;
}

/** A sequence flow (edge) between two nodes. */
export interface DesignerEdge {
  id: string;
  source: string; // source node id
  target: string; // target node id
  label?: string;
  condition?: string;
  waypoints?: Array<{ x: number; y: number }>;
}

export const designerDefinitions = domainSchema.table("designer_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 2000 }),
  elements: jsonb("elements").$type<DesignerNode[]>().notNull().default([]),
  edges: jsonb("edges").$type<DesignerEdge[]>().notNull().default([]),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
});

export type DesignerDefinitionRow = typeof designerDefinitions.$inferSelect;
export type DesignerDefinitionInsert = typeof designerDefinitions.$inferInsert;

export const schema = { designerDefinitions };
