/**
 * cause-list — Drizzle table definitions.
 *
 * These tables live in the `court` PostgreSQL schema and mirror, column-for-column,
 * the DDL created by migrations/0001_court_core.sql.
 *
 * Scope: cause_lists, cause_list_items. The item table carries a denormalized
 * list_date (copied from the parent cause_list) so the DB-level btree_gist
 * exclusion constraint can prevent a courtroom being double-booked in the same
 * (tenant_id, list_date, slot) — even across different cause_lists.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Cause Lists ───────────────────────────────────────────────────────────────

export const causeLists = courtSchema.table("cause_lists", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  courtId:   uuid("court_id").notNull(),
  benchId:   uuid("bench_id"),
  listDate:  date("list_date").notNull(),
  status:    varchar("status", { length: 32 }).notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  version:   integer("version").notNull().default(1),
});

// ─── Cause List Items ──────────────────────────────────────────────────────────

export const causeListItems = courtSchema.table("cause_list_items", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  causeListId: uuid("cause_list_id").notNull(),
  caseId:      uuid("case_id").notNull(),
  itemNumber:  integer("item_number"),
  slot:        varchar("slot", { length: 32 }),
  courtroom:   varchar("courtroom", { length: 64 }),
  listDate:    date("list_date").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by"),
  updatedBy:   uuid("updated_by"),
  version:     integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type CauseListRow    = typeof causeLists.$inferSelect;
export type CauseListInsert = typeof causeLists.$inferInsert;

export type CauseListItemRow    = typeof causeListItems.$inferSelect;
export type CauseListItemInsert = typeof causeListItems.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const causeListSchema = {
  causeLists,
  causeListItems,
};
