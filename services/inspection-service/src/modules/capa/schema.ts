/**
 * inspection-service: CAPA (Corrective & Preventive Action) module Drizzle schema.
 *
 * Defines the `capa` PG schema with table:
 * - corrective_actions — CAPAs linked to findings with lifecycle tracking
 *
 * _Requirements: SVC-106_
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
  boolean,
} from "drizzle-orm/pg-core";

/** The `capa` PG schema — corrective and preventive actions. */
export const capaSchema = pgSchema("capa");

// ── capa.corrective_actions ───────────────────────────────────────────────
export const correctiveActions = capaSchema.table("corrective_actions", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  tenantId:               uuid("tenant_id").notNull(),
  findingId:              uuid("finding_id").notNull(),
  type:                   varchar("type", { length: 16 }).notNull(), // corrective|preventive
  description:            text("description").notNull(),
  ownerId:                uuid("owner_id"),
  dueDate:                date("due_date"),
  status:                 varchar("status", { length: 24 }).notNull().default("open"),
  evidenceOfClosure:      jsonb("evidence_of_closure"), // array of evidence items
  effectivenessVerified:  boolean("effectiveness_verified").notNull().default(false),
  verifiedBy:             uuid("verified_by"),
  verifiedAt:             timestamp("verified_at", { withTimezone: true }),
  reInspectionTriggered:  boolean("re_inspection_triggered").notNull().default(false),
  reInspectionId:         uuid("re_inspection_id"),
  escalatedTo:            uuid("escalated_to"),
  escalatedAt:            timestamp("escalated_at", { withTimezone: true }),
  closedAt:               timestamp("closed_at", { withTimezone: true }),
  closedBy:               uuid("closed_by"),
  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:              uuid("created_by").notNull(),
  updatedBy:              uuid("updated_by").notNull(),
  version:                integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────
export type CorrectiveActionRow = typeof correctiveActions.$inferSelect;
export type CorrectiveActionInsert = typeof correctiveActions.$inferInsert;

export const schema = { correctiveActions };
