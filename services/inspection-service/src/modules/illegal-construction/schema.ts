/**
 * inspection-service: Illegal Construction module Drizzle schema.
 *
 * Defines the `illegal_construction` PG schema with tables:
 * - illegal_construction_cases — reported cases of illegal construction
 * - illegal_construction_actions — enforcement actions (stop-work, sealing, demolition, fine, regularization)
 *
 * _Requirements: BRD 5.20 ILBLD-001..004_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  bigint,
  jsonb,
} from "drizzle-orm/pg-core";

/** The `illegal_construction` PG schema. */
export const illegalConstructionSchema = pgSchema("illegal_construction");

// ── illegal_construction.illegal_construction_cases ───────────────────────
export const illegalConstructionCases = illegalConstructionSchema.table("illegal_construction_cases", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  caseNumber:            varchar("case_number", { length: 40 }).notNull(),
  reportedBy:            uuid("reported_by").notNull(),
  reportedAt:            timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  location:              jsonb("location").notNull(),
  buildingPermitRef:     text("building_permit_ref"),
  ownerName:             text("owner_name").notNull(),
  ownerContact:          text("owner_contact"),
  violationType:         varchar("violation_type", { length: 30 }).notNull(),
  description:           text("description").notNull(),
  photos:                jsonb("photos"),
  status:                varchar("status", { length: 30 }).notNull().default("reported"),
  inspectedBy:           uuid("inspected_by"),
  inspectedAt:           timestamp("inspected_at", { withTimezone: true }),
  inspectionFindings:    jsonb("inspection_findings"),
  violationChecklist:    jsonb("violation_checklist"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
});

// ── illegal_construction.illegal_construction_actions ─────────────────────
export const illegalConstructionActions = illegalConstructionSchema.table("illegal_construction_actions", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  caseId:           uuid("case_id").notNull(),
  actionType:       varchar("action_type", { length: 30 }).notNull(),
  actionNumber:     varchar("action_number", { length: 40 }).notNull(),
  issuedAt:         timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  issuedBy:         uuid("issued_by").notNull(),
  status:           varchar("status", { length: 20 }).notNull().default("issued"),
  enforcedAt:       timestamp("enforced_at", { withTimezone: true }),
  details:          jsonb("details"),
  fineAmountMinor:  bigint("fine_amount_minor", { mode: "bigint" }),
  currency:         varchar("currency", { length: 3 }).notNull().default("INR"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────
export type IllegalConstructionCaseRow = typeof illegalConstructionCases.$inferSelect;
export type IllegalConstructionCaseInsert = typeof illegalConstructionCases.$inferInsert;
export type IllegalConstructionActionRow = typeof illegalConstructionActions.$inferSelect;
export type IllegalConstructionActionInsert = typeof illegalConstructionActions.$inferInsert;

export const schema = { illegalConstructionCases, illegalConstructionActions };
