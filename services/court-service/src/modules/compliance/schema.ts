/**
 * compliance — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0005_court_compliance.sql.
 *
 * Scope: compliance_directions (§26 — execution / compliance monitoring of orders).
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Compliance Directions ─────────────────────────────────────────────────────

export const complianceDirections = courtSchema.table("compliance_directions", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  caseId:               uuid("case_id").notNull(),
  orderId:              uuid("order_id"),
  direction:            text("direction").notNull(),
  responsibleAuthority: varchar("responsible_authority", { length: 120 }),
  dueDate:              date("due_date"),
  status:               varchar("status", { length: 16 }).notNull().default("pending"),
  progressNotes:        text("progress_notes"),
  closedAt:             timestamp("closed_at", { withTimezone: true }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by"),
  updatedBy:            uuid("updated_by"),
  version:              integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type ComplianceDirectionRow    = typeof complianceDirections.$inferSelect;
export type ComplianceDirectionInsert = typeof complianceDirections.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const complianceSchema = {
  complianceDirections,
};
