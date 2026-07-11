/**
 * hearing — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0001_court_core.sql.
 *
 * Scope: hearings.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Hearings ──────────────────────────────────────────────────────────────────

export const hearings = courtSchema.table("hearings", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  caseId:            uuid("case_id").notNull(),
  benchId:           uuid("bench_id"),
  scheduledDate:     timestamp("scheduled_date", { withTimezone: true }),
  status:            varchar("status", { length: 32 }).notNull().default("scheduled"),
  nextDate:          date("next_date"),
  purpose:           varchar("purpose", { length: 64 }),
  adjournmentReason: text("adjournment_reason"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by"),
  updatedBy:         uuid("updated_by"),
  version:           integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type HearingRow    = typeof hearings.$inferSelect;
export type HearingInsert = typeof hearings.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const hearingSchema = {
  hearings,
};
