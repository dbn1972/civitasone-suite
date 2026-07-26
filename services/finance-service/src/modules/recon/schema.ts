import { pgSchema, uuid, text, varchar, integer, bigint, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * CAP-059 — reconciliation persistence (finance-service, DB civitas_finance).
 * Mirrors migration 0049_reconciliation_engine.sql. Schema `recon`.
 */
export const reconSchema = pgSchema("recon");

export const reconRun = reconSchema.table("recon_run", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  provider:     varchar("provider", { length: 64 }).notNull(),
  sourceSystem: text("source_system").notNull(),
  targetSystem: text("target_system").notNull(),
  status:       varchar("status", { length: 16 }).notNull().default("completed"),
  sourceCount:  integer("source_count").notNull().default(0),
  targetCount:  integer("target_count").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
  breakCount:   integer("break_count").notNull().default(0),
  balanced:     boolean("balanced").notNull().default(false),
  params:       jsonb("params"),
  note:         text("note"),
  startedAt:    timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:  timestamp("completed_at", { withTimezone: true }),
  triggeredBy:  uuid("triggered_by"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reconBreak = reconSchema.table("recon_break", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  runId:          uuid("run_id").notNull(),
  breakKey:       text("break_key").notNull(),
  breakType:      varchar("break_type", { length: 24 }).notNull(),
  field:          text("field"),
  fieldType:      varchar("field_type", { length: 16 }),
  sourceValue:    text("source_value"),
  targetValue:    text("target_value"),
  deltaMinor:     bigint("delta_minor", { mode: "bigint" }),
  severity:       varchar("severity", { length: 8 }).notNull().default("medium"),
  status:         varchar("status", { length: 16 }).notNull().default("open"),
  resolutionNote: text("resolution_note"),
  resolvedBy:     uuid("resolved_by"),
  resolvedAt:     timestamp("resolved_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});

export type ReconRunRow      = typeof reconRun.$inferSelect;
export type ReconRunInsert   = typeof reconRun.$inferInsert;
export type ReconBreakRow    = typeof reconBreak.$inferSelect;
export type ReconBreakInsert = typeof reconBreak.$inferInsert;

export const schema = { reconRun, reconBreak };
