/**
 * case-parcel — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0012_court_parcel.sql.
 *
 * Scope: the case↔parcel linkage for the revenue-court domain (disputed land
 * parcels identified by survey / khasra numbers).
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 *
 * area_sqm is a BIGINT holding whole square metres (no floats) — declared with
 * Drizzle `mode: "bigint"` so it surfaces in JS as a native `bigint` (never a
 * lossy Number). Callers MUST stringify it before JSON serialisation.
 */
import { pgSchema, uuid, text, integer, varchar, boolean, bigint, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Case parcels ───────────────────────────────────────────────────────────────

export const caseParcels = courtSchema.table("case_parcels", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  caseId:       uuid("case_id").notNull(),
  surveyNumber: varchar("survey_number", { length: 64 }).notNull(),
  khasraNumber: varchar("khasra_number", { length: 64 }),
  khataNumber:  varchar("khata_number", { length: 64 }),
  village:      varchar("village", { length: 120 }).notNull(),
  tehsil:       varchar("tehsil", { length: 120 }),
  district:     varchar("district", { length: 120 }),
  areaSqm:      bigint("area_sqm", { mode: "bigint" }),
  subjectType:  varchar("subject_type", { length: 32 }).notNull().default("land"),
  ownershipRef: varchar("ownership_ref", { length: 120 }),
  remarks:      text("remarks"),
  active:       boolean("active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by"),
  updatedBy:    uuid("updated_by"),
  version:      integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type CaseParcelRow    = typeof caseParcels.$inferSelect;
export type CaseParcelInsert = typeof caseParcels.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const parcelSchema = {
  caseParcels,
};
