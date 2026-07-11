/**
 * appeal — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0004_court_appeal.sql.
 *
 * Scope: appeals (§25 appeal / revision / review).
 *
 * The module is self-contained: it owns ONE table and does NOT write to
 * court.case_state_transitions — the appeal lifecycle is independent of the
 * original case's lifecycle.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Appeals ───────────────────────────────────────────────────────────────────

export const appeals = courtSchema.table("appeals", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  originalCaseId:  uuid("original_case_id").notNull(),
  appellateCaseId: uuid("appellate_case_id"),
  appealType:      varchar("appeal_type", { length: 24 }).notNull().default("appeal"),
  grounds:         text("grounds").notNull(),
  status:          varchar("status", { length: 16 }).notNull().default("filed"),
  filedDate:       date("filed_date").notNull(),
  decidedDate:     date("decided_date"),
  decisionSummary: text("decision_summary"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by"),
  updatedBy:       uuid("updated_by"),
  version:         integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type AppealRow    = typeof appeals.$inferSelect;
export type AppealInsert = typeof appeals.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const appealSchema = {
  appeals,
};
