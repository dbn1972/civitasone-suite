/**
 * scrutiny — Drizzle table definitions.
 *
 * These tables live in the `court` PostgreSQL schema and mirror, column-for-column,
 * the DDL created by migrations/0002_court_scrutiny.sql.
 *
 * Scope: case_scrutiny, case_defect (registry scrutiny + defect management, §13).
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Case Scrutiny ─────────────────────────────────────────────────────────────

export const caseScrutiny = courtSchema.table("case_scrutiny", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  caseId:        uuid("case_id").notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  scrutinizedBy: uuid("scrutinized_by"),
  remarks:       text("remarks"),
  scrutinizedAt: timestamp("scrutinized_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

// ─── Case Defect ───────────────────────────────────────────────────────────────

export const caseDefect = courtSchema.table("case_defect", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  caseId:                uuid("case_id").notNull(),
  scrutinyId:            uuid("scrutiny_id"),
  category:              varchar("category", { length: 48 }).notNull(),
  description:           text("description").notNull(),
  severity:              varchar("severity", { length: 16 }).notNull().default("minor"),
  status:                varchar("status", { length: 16 }).notNull().default("raised"),
  rectificationDeadline: date("rectification_deadline"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by"),
  updatedBy:             uuid("updated_by"),
  version:               integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type CaseScrutinyRow    = typeof caseScrutiny.$inferSelect;
export type CaseScrutinyInsert = typeof caseScrutiny.$inferInsert;

export type CaseDefectRow    = typeof caseDefect.$inferSelect;
export type CaseDefectInsert = typeof caseDefect.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const scrutinySchema = {
  caseScrutiny,
  caseDefect,
};
