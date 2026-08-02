/**
 * WC-009 — sandbox environments with masked refresh. Drizzle schema.
 *
 * Lives in its OWN Postgres schema `sandbox` (L2 rule: this module's repo
 * queries ONLY `sandbox.*`). Follows the job+status shape already used by the
 * `backup` (admin_backup_runs) and `data-export` (export_requests) modules.
 *
 * IMPORTANT: nothing in this module copies data. `refresh_jobs.dataMovement`
 * records that fact explicitly ('stubbed'); the real copy is a queued boundary
 * documented in consumer.ts.
 */
import { pgSchema, uuid, varchar, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const sandboxPgSchema = pgSchema("sandbox");

export const sandboxEnvironments = sandboxPgSchema.table("sandbox_environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  /** dev | staging | uat | production — where a refresh would read FROM. */
  sourceEnvironment: varchar("source_environment", { length: 32 }).notNull(),
  /** registered | refreshing | ready | disabled */
  status: varchar("status", { length: 24 }).notNull().default("registered"),
  lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  codeUnique: uniqueIndex("uq_sandbox_env_code").on(t.tenantId, t.code),
}));

export const maskingRules = sandboxPgSchema.table("masking_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  sandboxId: uuid("sandbox_id").notNull(),
  tableName: varchar("table_name", { length: 128 }).notNull(),
  fieldName: varchar("field_name", { length: 128 }).notNull(),
  /** redact | hash | partial | nullify | preserve — 'preserve' is the ONLY pass-through. */
  strategy: varchar("strategy", { length: 24 }).notNull(),
  justification: text("justification").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  fieldUnique: uniqueIndex("uq_masking_rules_field").on(t.tenantId, t.sandboxId, t.tableName, t.fieldName),
}));

export const refreshJobs = sandboxPgSchema.table("refresh_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  sandboxId: uuid("sandbox_id").notNull(),
  sourceEnvironment: varchar("source_environment", { length: 32 }).notNull(),
  /** The (table, field) pairs the caller wants copied. */
  requestedFields: jsonb("requested_fields")
    .$type<Array<{ tableName: string; fieldName: string }>>().notNull().default([]),
  /** pending_approval | rejected | queued | running | completed | failed */
  status: varchar("status", { length: 24 }).notNull().default("pending_approval"),
  requestedBy: uuid("requested_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** stubbed | executed — always 'stubbed' here; see consumer.ts. */
  dataMovement: varchar("data_movement", { length: 16 }).notNull().default("stubbed"),
  maskedFieldCount: integer("masked_field_count").notNull().default(0),
  preservedFieldCount: integer("preserved_field_count").notNull().default(0),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/** What was masked, by NAME and strategy. Never the values themselves. */
export const refreshMaskedFields = sandboxPgSchema.table("refresh_masked_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  jobId: uuid("job_id").notNull(),
  tableName: varchar("table_name", { length: 128 }).notNull(),
  fieldName: varchar("field_name", { length: 128 }).notNull(),
  strategy: varchar("strategy", { length: 24 }).notNull(),
  /** rule = an explicit masking_rules row matched; default = fail-closed default. */
  ruleSource: varchar("rule_source", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SandboxEnvironmentRow = typeof sandboxEnvironments.$inferSelect;
export type SandboxEnvironmentInsert = typeof sandboxEnvironments.$inferInsert;
export type MaskingRuleRow = typeof maskingRules.$inferSelect;
export type MaskingRuleInsert = typeof maskingRules.$inferInsert;
export type RefreshJobRow = typeof refreshJobs.$inferSelect;
export type RefreshJobInsert = typeof refreshJobs.$inferInsert;
export type RefreshMaskedFieldRow = typeof refreshMaskedFields.$inferSelect;
export type RefreshMaskedFieldInsert = typeof refreshMaskedFields.$inferInsert;

export const schema = { sandboxEnvironments, maskingRules, refreshJobs, refreshMaskedFields };
