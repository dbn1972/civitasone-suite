/**
 * Planning module — Drizzle schema for inspection plans.
 *
 * Manages the inspection plan lifecycle: draft → pending_approval → active.
 * Plans define which entities will be inspected based on risk thresholds
 * and selection criteria, and integrate with workflow-service for approval.
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/** The `planning` PG schema — inspection plan lifecycle. */
export const planningSchema = pgSchema("planning");

/**
 * Inspection plans define which regulated entities will be inspected over a period.
 *
 * - `status`: draft | pending_approval | active
 * - `selectionCriteria`: JSONB filter rules for entity selection (risk threshold, categories, etc.)
 * - `entityIds`: JSONB array of selected entity UUIDs
 * - `workflowInstanceId`: link to workflow-service approval instance (set on submit)
 *
 * Lifecycle:
 *   draft → pending_approval (submit for approval)
 *   pending_approval → active (approved) | draft (rejected/returned)
 *   active → (terminal, no further modifications to entity selection)
 */
export const inspectionPlans = planningSchema.table("inspection_plans", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  name:               text("name").notNull(),
  description:        text("description"),
  periodStart:        date("period_start").notNull(),
  periodEnd:          date("period_end").notNull(),
  status:             varchar("status", { length: 24 }).notNull().default("draft"), // draft|pending_approval|active
  riskThreshold:      integer("risk_threshold"), // minimum risk score for inclusion
  selectionCriteria:  jsonb("selection_criteria"), // filter rules for entity selection
  entityIds:          jsonb("entity_ids").notNull(), // uuid[] — selected entities
  workflowInstanceId: uuid("workflow_instance_id"), // link to workflow-service approval
  approvedAt:         timestamp("approved_at", { withTimezone: true }),
  approvedBy:         uuid("approved_by"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
}, (t) => ({
  tenantStatus: index("idx_inspection_plans_tenant_status").on(t.tenantId, t.status),
}));

// ── Inferred types ────────────────────────────────────────────────────────
export type InspectionPlanRow = typeof inspectionPlans.$inferSelect;
export type InspectionPlanInsert = typeof inspectionPlans.$inferInsert;

export const schema = { inspectionPlans };
