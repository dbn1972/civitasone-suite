/**
 * Workforce Core — Drizzle models for the `workforce_core` schema
 * (SmartTransfer OS, ST-M01-07).
 *
 * Spec §4 (Universal domain model). Decisions D-ST-01 (Post + effective-dated
 * Occupancy owned by Workforce Core), D-ST-02 (office = HRMS department tree, by
 * id), D-ST-03 (cadre master + employee-cadre link + cadre-wise seniority),
 * D-ST-23 (Workforce Core is a liftable module profile of hrms-service — these
 * tables live in their own `workforce_core` schema so they can be extracted
 * later). Kept in lock-step with migration
 * `migrations/0201_workforce_core.sql` (schema-drift-guard: every column a model
 * declares must exist in the live DB).
 *
 * No cross-service foreign keys: office_id, designation_id and employee_id
 * reference other domains BY ID only (CLAUDE.md §3.13, D-ST-10). Money/marks n/a.
 */
import {
  pgSchema, uuid, varchar, integer, date, jsonb, timestamp,
} from "drizzle-orm/pg-core";

export const workforceCoreSchema = pgSchema("workforce_core");

/** Cadre master (hierarchical via parent_cadre_id). D-ST-03. */
export const wcCadre = workforceCoreSchema.table("cadre", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  parentCadreId: uuid("parent_cadre_id"),
  code:          varchar("code", { length: 64 }).notNull(),
  name:          varchar("name", { length: 200 }).notNull(),
  externalCode:  varchar("external_code", { length: 128 }),
  status:        varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

/** Employee→cadre link + cadre-wise seniority. D-ST-03. */
export const wcEmployeeCadre = workforceCoreSchema.table("employee_cadre", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  cadreId:       uuid("cadre_id").notNull(),
  seniorityDate: date("seniority_date").notNull(),
  seniorityRank: integer("seniority_rank"),
  status:        varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

/** Sanctioned Post (office/designation/cadre/attributes/status). D-ST-01/02. */
export const wcPost = workforceCoreSchema.table("post", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  postNo:        varchar("post_no", { length: 64 }).notNull(),
  officeId:      uuid("office_id").notNull(),
  designationId: uuid("designation_id"),
  cadreId:       uuid("cadre_id"),
  gradePayLevel: varchar("grade_pay_level", { length: 32 }),
  reservationTag: varchar("reservation_tag", { length: 16 }),
  attributes:    jsonb("attributes").notNull().default({}),
  status:        varchar("status", { length: 16 }).notNull().default("sanctioned"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

/**
 * Post Occupancy — effective-dated. The DB enforces (a) one substantive holder
 * per post and (b) one substantive post per employee at any instant via
 * EXCLUDE USING gist constraints in the migration (not expressible in Drizzle).
 * D-ST-01.
 */
export const wcPostOccupancy = workforceCoreSchema.table("post_occupancy", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  postId:        uuid("post_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  chargeType:    varchar("charge_type", { length: 16 }).notNull().default("substantive"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:   date("effective_to"),
  orderRef:      varchar("order_ref", { length: 128 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

/**
 * Posting Ledger — append-only effective-dated posting history. Tenure is
 * derivable (workforce_core.service_tenure_days / current_station_tenure_days).
 * "Live behind a flag" per M01 exit criterion 2 — WORKFORCE_CORE_LEDGER_ENABLED
 * (config.ts, default off) gates the write path added in ST-M01-09. D-ST-01.
 */
export const wcPostingLedger = workforceCoreSchema.table("posting_ledger", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  officeId:      uuid("office_id").notNull(),
  postId:        uuid("post_id"),
  chargeType:    varchar("charge_type", { length: 16 }).notNull().default("substantive"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:   date("effective_to"),
  orderRef:      varchar("order_ref", { length: 128 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  version:       integer("version").notNull().default(1),
});

export type WcCadreRow = typeof wcCadre.$inferSelect;
export type WcCadreInsert = typeof wcCadre.$inferInsert;
export type WcEmployeeCadreRow = typeof wcEmployeeCadre.$inferSelect;
export type WcEmployeeCadreInsert = typeof wcEmployeeCadre.$inferInsert;
export type WcPostRow = typeof wcPost.$inferSelect;
export type WcPostInsert = typeof wcPost.$inferInsert;
export type WcPostOccupancyRow = typeof wcPostOccupancy.$inferSelect;
export type WcPostOccupancyInsert = typeof wcPostOccupancy.$inferInsert;
export type WcPostingLedgerRow = typeof wcPostingLedger.$inferSelect;
export type WcPostingLedgerInsert = typeof wcPostingLedger.$inferInsert;

export const schema = {
  wcCadre,
  wcEmployeeCadre,
  wcPost,
  wcPostOccupancy,
  wcPostingLedger,
};
