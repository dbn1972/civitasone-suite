/**
 * court-registry — Drizzle table definitions.
 *
 * These tables live in the `court` PostgreSQL schema and mirror, column-for-column,
 * the DDL created by migrations/0001_court_core.sql. Column types are chosen to
 * match the migration exactly (uuid, varchar(N), text, timestamptz, integer version)
 * so Drizzle's view of the schema never drifts from the database.
 *
 * Scope: the court-registry tables — courts, benches. Sibling modules
 * (case-registry, cause-list, hearing, order, filing) own their own schema.ts files;
 * the shared db.ts merges every module's exported tables into one Drizzle client.
 *
 * Standard entity columns on the mutable tables: id (uuid PK), tenant_id, created_at,
 * updated_at, created_by, updated_by, version (optimistic-locking int).
 */
import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Courts ────────────────────────────────────────────────────────────────────

export const courts = courtSchema.table("courts", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  name:              text("name").notNull(),
  courtType:         varchar("court_type", { length: 32 }).notNull(),
  jurisdiction:      text("jurisdiction"),
  establishmentCode: varchar("establishment_code", { length: 64 }),
  parentCourtId:     uuid("parent_court_id"),
  address:           text("address"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by"),
  updatedBy:         uuid("updated_by"),
  version:           integer("version").notNull().default(1),
});

// ─── Benches ───────────────────────────────────────────────────────────────────

export const benches = courtSchema.table("benches", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  courtId:          uuid("court_id").notNull(),
  name:             text("name").notNull(),
  presidingJudgeId: uuid("presiding_judge_id"),
  benchType:        varchar("bench_type", { length: 32 }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by"),
  updatedBy:        uuid("updated_by"),
  version:          integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type CourtRow    = typeof courts.$inferSelect;
export type CourtInsert = typeof courts.$inferInsert;

export type BenchRow    = typeof benches.$inferSelect;
export type BenchInsert = typeof benches.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const courtRegistrySchema = {
  courts,
  benches,
};
