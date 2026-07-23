/**
 * inspection-service: execution module Drizzle schema.
 *
 * Defines the `execution` PG schema with tables for inspection lifecycle:
 * - inspections — core inspection records with state, assignment, and timestamps
 * - inspection_history — audit trail of state transitions
 *
 * _Requirements: 8.1, 8.2, 8.8_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

/** The `execution` PG schema — inspection lifecycle management. */
export const executionSchema = pgSchema("execution");

// ── execution.inspections ─────────────────────────────────────────────────
export const inspections = executionSchema.table("inspections", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  entityId:         uuid("entity_id").notNull(),
  inspectionTypeId: uuid("inspection_type_id").notNull(),
  planId:           uuid("plan_id"),
  state:            varchar("state", { length: 24 }).notNull().default("scheduled"),
  assignedInspectors: jsonb("assigned_inspectors").notNull(), // uuid[]
  reviewerId:       uuid("reviewer_id"),
  startedAt:        timestamp("started_at", { withTimezone: true }),
  completedAt:      timestamp("completed_at", { withTimezone: true }),
  finalizedAt:      timestamp("finalized_at", { withTimezone: true }),
  reportS3Key:      text("report_s3_key"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ── execution.inspection_history ──────────────────────────────────────────
export const inspectionHistory = executionSchema.table("inspection_history", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  inspectionId:     uuid("inspection_id").notNull(),
  previousState:    varchar("previous_state", { length: 24 }).notNull(),
  newState:         varchar("new_state", { length: 24 }).notNull(),
  actorId:          uuid("actor_id").notNull(),
  remarks:          text("remarks"),
  transitionedAt:   timestamp("transitioned_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:          integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────
export type InspectionRow = typeof inspections.$inferSelect;
export type InspectionInsert = typeof inspections.$inferInsert;
export type InspectionHistoryRow = typeof inspectionHistory.$inferSelect;
export type InspectionHistoryInsert = typeof inspectionHistory.$inferInsert;

export const schema = { inspections, inspectionHistory };
