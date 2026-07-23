/**
 * inspection-service: checklist module Drizzle schema.
 *
 * Defines the `checklist` PG schema with tables for:
 * - checklist_templates — versioned form definitions with sections, questions, scoring rules, and conditional logic
 * - checklist_instances — filled-in copies of templates bound to specific inspection executions
 *
 * _Requirements: 5.1, 5.2, 5.3_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  jsonb,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** The `checklist` PG schema — template definitions and inspection-bound instances. */
export const checklistSchema = pgSchema("checklist");

// ── checklist.checklist_templates ─────────────────────────────────────────
/**
 * Checklist templates define the structure of an inspection form.
 *
 * ### `sections` JSONB shape:
 * ```ts
 * type ChecklistSection = {
 *   id: string;
 *   title: string;
 *   sortOrder: number;
 *   weight: number;
 *   prerequisite?: { sectionId: string; minScore: number };
 *   questions: ChecklistQuestion[];
 * };
 *
 * type ChecklistQuestion = {
 *   id: string;
 *   text: string;
 *   fieldType: FieldType;
 *   sortOrder: number;
 *   weight: number;
 *   required: boolean;
 *   validationRules?: object;
 *   helpText?: string;
 *   conditionalLogic?: ConditionalRule[];
 * };
 *
 * type FieldType = "text" | "number" | "boolean" | "select" | "multi_select" | "photo" | "signature" | "geo_point";
 *
 * type ConditionalRule = {
 *   dependsOn: string;
 *   operator: "eq" | "neq" | "gt" | "lt";
 *   value: unknown;
 *   action: "show" | "hide";
 * };
 * ```
 */
export const checklistTemplates = checklistSchema.table("checklist_templates", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  name:          text("name").notNull(),
  code:          varchar("code", { length: 32 }).notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  status:        varchar("status", { length: 16 }).notNull().default("draft"), // draft|published
  sections:      jsonb("sections").notNull(), // ChecklistSection[]
  publishedAt:   timestamp("published_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
}, (table) => ({
  uniqueCodeVersionPerTenant: uniqueIndex("idx_checklist_templates_tenant_code_version")
    .on(table.tenantId, table.code, table.versionNumber),
}));

// ── checklist.checklist_instances ─────────────────────────────────────────
/**
 * Checklist instances are deep-copied template structures bound to a specific inspection.
 *
 * ### `responses` JSONB shape:
 * ```ts
 * type Responses = Record<string, { value: unknown; answeredAt: string }>;
 * ```
 *
 * ### `sectionScores` JSONB shape:
 * ```ts
 * type SectionScores = Record<string, number>; // { [sectionId]: score 0–100 }
 * ```
 */
export const checklistInstances = checklistSchema.table("checklist_instances", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  templateId:      uuid("template_id").notNull(),
  templateVersion: integer("template_version").notNull(),
  inspectionId:    uuid("inspection_id").notNull(),
  sections:        jsonb("sections").notNull(), // deep copy from template
  responses:       jsonb("responses"), // { [questionId]: { value, answeredAt } }
  sectionScores:   jsonb("section_scores"), // { [sectionId]: number }
  overallScore:    numeric("overall_score", { precision: 5, scale: 2 }),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
}, (table) => ({
  indexTenantInspection: index("idx_checklist_instances_tenant_inspection")
    .on(table.tenantId, table.inspectionId),
}));

// ── Inferred types ────────────────────────────────────────────────────────
export type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
export type ChecklistTemplateInsert = typeof checklistTemplates.$inferInsert;
export type ChecklistInstanceRow = typeof checklistInstances.$inferSelect;
export type ChecklistInstanceInsert = typeof checklistInstances.$inferInsert;

export const schema = { checklistTemplates, checklistInstances };
