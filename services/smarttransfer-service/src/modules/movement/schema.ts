/**
 * SmartTransfer movement entities — Drizzle schema in Postgres schema
 * `smarttransfer`. One owning service for the movement entities only
 * (D-ST-10): cycle, request, preference (+ item), scenario, run, assignment,
 * order, relieving record, joining record, appeal, evidence.
 *
 * MINIMAL v1 columns: id, tenant_id, a jurisdiction/org-unit scope column,
 * status, version, created/updated audit columns, plus the few opaque
 * references each entity needs (all `by id` — NO cross-service FK; D-ST-10,
 * docs/ARCHITECTURE.md §5).
 *
 * DELIBERATELY ABSENT (depend on PROPOSED decisions — kept out, listed in the
 * PR body): solver output detail (D-ST-05), policy rule/citation detail
 * (D-ST-07), signing columns (D-ST-12), payroll/DDO/TA-DA columns
 * (D-ST-13/14), override reason/dual-approval columns (D-ST-18). A later
 * milestone adds them once the decisions are approved.
 *
 * Columns verified 1:1 against migrations/0001_init.sql.
 */
import { pgSchema, uuid, varchar, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const stSchema = pgSchema("smarttransfer");

/** Standard audit/scope columns shared by every movement table. */
const base = {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  // D-ST-04: one tenant per cycle-owning authority; districts are org-unit /
  // jurisdiction scopes. This opaque id scopes a row to a jurisdiction/org-unit
  // (set from the server context, never from a client id). Nullable: a
  // tenant-wide row (e.g. a state-level cycle) carries no narrower scope.
  jurisdictionUnitId: uuid("jurisdiction_unit_id"),
  status: varchar("status", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
};

// ── Cycle (the one wired write path in M01) ──────────────────────────────────
export const cycles = stSchema.table("cycles", {
  ...base,
  name: varchar("name", { length: 200 }).notNull(),
  // Movement type is referenced by opaque id (the movement-type catalogue is a
  // later deliverable); a plain id string, no FK.
  movementTypeId: uuid("movement_type_id"),
  // Minimal cycle calendar; stored as a jsonb bag of ISO instants so the shape
  // can grow without a schema migration. No policy/solver columns here.
  calendar: jsonb("calendar").$type<{ opensAt?: string; freezesAt?: string; closesAt?: string }>(),
});
export type CycleRow = typeof cycles.$inferSelect;
export type CycleInsert = typeof cycles.$inferInsert;

// ── Request ──────────────────────────────────────────────────────────────────
export const requests = stSchema.table("requests", {
  ...base,
  cycleId: uuid("cycle_id").notNull(),
  employeeId: uuid("employee_id").notNull(), // by id (Workforce Core)
  movementTypeId: uuid("movement_type_id"),
});
export type RequestRow = typeof requests.$inferSelect;

// ── Preference (+ item) ───────────────────────────────────────────────────────
export const preferences = stSchema.table("preferences", {
  ...base,
  cycleId: uuid("cycle_id").notNull(),
  employeeId: uuid("employee_id").notNull(), // by id
});
export type PreferenceRow = typeof preferences.$inferSelect;

export const preferenceItems = stSchema.table("preference_items", {
  ...base,
  preferenceId: uuid("preference_id").notNull(),
  postId: uuid("post_id").notNull(), // by id (Workforce Core)
  rank: integer("rank").notNull(),
});
export type PreferenceItemRow = typeof preferenceItems.$inferSelect;

// ── Scenario ───────────────────────────────────────────────────────────────
export const scenarios = stSchema.table("scenarios", {
  ...base,
  cycleId: uuid("cycle_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
});
export type ScenarioRow = typeof scenarios.$inferSelect;

// ── Run (allocation run) ─────────────────────────────────────────────────────
export const runs = stSchema.table("runs", {
  ...base,
  cycleId: uuid("cycle_id").notNull(),
  scenarioId: uuid("scenario_id"),
  // Replay inputs (deterministic). NO solver output detail (D-ST-05) here.
  snapshotId: uuid("snapshot_id"),
  seed: integer("seed"),
});
export type RunRow = typeof runs.$inferSelect;

// ── Assignment (recommended assignment) ──────────────────────────────────────
export const assignments = stSchema.table("assignments", {
  ...base,
  runId: uuid("run_id").notNull(),
  employeeId: uuid("employee_id").notNull(), // by id
  postId: uuid("post_id").notNull(), // by id
});
export type AssignmentRow = typeof assignments.$inferSelect;

// ── Order (movement order) ───────────────────────────────────────────────────
export const orders = stSchema.table("orders", {
  ...base,
  assignmentId: uuid("assignment_id").notNull(),
  employeeId: uuid("employee_id").notNull(), // by id
  orderNumber: varchar("order_number", { length: 64 }),
  // NO signing columns (D-ST-12) — signing posture is a PROPOSED decision.
});
export type OrderRow = typeof orders.$inferSelect;

// ── Relieving record ─────────────────────────────────────────────────────────
export const relievingRecords = stSchema.table("relieving_records", {
  ...base,
  orderId: uuid("order_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  sourceOfficeId: uuid("source_office_id"),
  relievedOn: timestamp("relieved_on", { withTimezone: true }),
});
export type RelievingRecordRow = typeof relievingRecords.$inferSelect;

// ── Joining record ───────────────────────────────────────────────────────────
export const joiningRecords = stSchema.table("joining_records", {
  ...base,
  orderId: uuid("order_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  destOfficeId: uuid("dest_office_id"),
  joinedOn: timestamp("joined_on", { withTimezone: true }),
});
export type JoiningRecordRow = typeof joiningRecords.$inferSelect;

// ── Appeal (representation / appeal) ─────────────────────────────────────────
export const appeals = stSchema.table("appeals", {
  ...base,
  orderId: uuid("order_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  groundCode: varchar("ground_code", { length: 64 }),
  // NO override/dual-approval columns (D-ST-18) — PROPOSED.
});
export type AppealRow = typeof appeals.$inferSelect;

// ── Evidence (decision evidence index) ───────────────────────────────────────
export const evidence = stSchema.table("evidence", {
  ...base,
  runId: uuid("run_id").notNull(),
  // Replay anchors only; the rich evidence bundle (solver version/seed detail,
  // D-ST-05) is out until that decision is approved.
  snapshotHash: varchar("snapshot_hash", { length: 128 }),
  policyPackHash: varchar("policy_pack_hash", { length: 128 }),
});
export type EvidenceRow = typeof evidence.$inferSelect;

/** All movement tables, for the drizzle db schema binding. */
export const schema = {
  cycles,
  requests,
  preferences,
  preferenceItems,
  scenarios,
  runs,
  assignments,
  orders,
  relievingRecords,
  joiningRecords,
  appeals,
  evidence,
};
