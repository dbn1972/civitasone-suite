/**
 * pipelines module — Drizzle schema.
 * Stores sales pipeline definitions with configurable stages (3–10 per pipeline).
 * Each stage has a name, probability (0–100), and ordinal for ordering.
 */
import { pgSchema, uuid, varchar, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/**
 * A pipeline stage definition stored in the stages JSONB array.
 * Probability represents the likelihood of closure at this stage (0–100%).
 */
export interface PipelineStage {
  id: string;
  name: string;
  probability: number; // 0–100
  ordinal: number;
}

export const pipelines = crmSchema.table("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  stages: jsonb("stages").$type<PipelineStage[]>().notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PipelineRow = typeof pipelines.$inferSelect;
export type PipelineInsert = typeof pipelines.$inferInsert;

export type PipelineView = {
  id: string;
  tenantId: string;
  name: string;
  stages: PipelineStage[];
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const schema = { pipelines };
