/**
 * pipelines module — Drizzle schema.
 * Stores sales pipeline definitions with configurable stages (3–10 per pipeline).
 * Each stage has a name, probability (0–100), an ordinal, and (OP-002) an optional
 * list of mandatory opportunity fields that must be populated before a deal may ENTER
 * that stage, plus an optional gate flag.
 *
 * Pipelines can differ by product / region / business_unit (OP-002): those nullable
 * scope columns let a tenant keep a distinct pipeline per product line, geography or BU.
 */
import { pgSchema, uuid, varchar, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/**
 * A pipeline stage definition stored in the stages JSONB array.
 * Probability represents the likelihood of closure at this stage (0–100%).
 * `mandatoryFields` are deal field names required to move INTO this stage (OP-003).
 * `gate` marks a stage that cannot be skipped over (advisory; enforcement is by ordinal).
 */
export interface PipelineStage {
  id: string;
  name: string;
  probability: number; // 0–100
  ordinal: number;
  mandatoryFields?: string[] | undefined;
  gate?: boolean | undefined;
}

export const pipelines = crmSchema.table("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  stages: jsonb("stages").$type<PipelineStage[]>().notNull(),
  product: varchar("product", { length: 120 }),
  region: varchar("region", { length: 120 }),
  businessUnit: varchar("business_unit", { length: 120 }),
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
  product: string | null;
  region: string | null;
  businessUnit: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const schema = { pipelines };
