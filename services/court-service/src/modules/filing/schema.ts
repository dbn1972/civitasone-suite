/**
 * filing — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0001_court_core.sql.
 *
 * Scope: filings. Monetary amounts (filing_fee_minor, court_fee_minor) are BIGINT
 * paise (minor units) — never floats. Drizzle `bigint` with mode "number" surfaces
 * them as JS numbers for the app layer.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, integer, bigint, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Filings ───────────────────────────────────────────────────────────────────

export const filings = courtSchema.table("filings", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  caseId:         uuid("case_id").notNull(),
  filingType:     varchar("filing_type", { length: 32 }),
  filingFeeMinor: bigint("filing_fee_minor", { mode: "number" }).notNull().default(0),
  courtFeeMinor:  bigint("court_fee_minor", { mode: "number" }).notNull().default(0),
  status:         varchar("status", { length: 32 }).notNull().default("submitted"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by"),
  updatedBy:      uuid("updated_by"),
  version:        integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type FilingRow    = typeof filings.$inferSelect;
export type FilingInsert = typeof filings.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const filingSchema = {
  filings,
};
