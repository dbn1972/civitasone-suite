import { pgSchema, uuid, varchar, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";

const tenantSchema = pgSchema("tenant");

export const migrations = tenantSchema.table("data_migrations", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  sourceTenantId:  uuid("source_tenant_id").notNull(),
  targetTenantId:  uuid("target_tenant_id").notNull(),
  entities:        jsonb("entities").notNull(),
  status:          varchar("status", { length: 24 }).notNull().default("pending"),
  dryRun:          varchar("dry_run", { length: 5 }).notNull().default("true"),
  recordsMigrated: integer("records_migrated").notNull().default(0),
  errors:          jsonb("errors").notNull().default([]),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
  createdBy:       uuid("created_by").notNull(),
});

export const reconciliations = tenantSchema.table("reconciliations", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  entityType:    varchar("entity_type", { length: 64 }).notNull(),
  sourceSystem:  varchar("source_system", { length: 64 }).notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  breakCount:    integer("break_count").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export const importBatches = tenantSchema.table("import_batches", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  entityType:  varchar("entity_type", { length: 64 }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("queued"),
  total:       integer("total").notNull().default(0),
  inserted:    integer("inserted").notNull().default(0),
  failed:      integer("failed").notNull().default(0),
  errors:      jsonb("errors").notNull().default([]),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy:   uuid("created_by").notNull(),
});

export const exportJobs = tenantSchema.table("export_jobs", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  entityType:  varchar("entity_type", { length: 64 }).notNull(),
  format:      varchar("format", { length: 8 }).notNull().default("json"),
  status:      varchar("status", { length: 24 }).notNull().default("generating"),
  recordCount: integer("record_count").notNull().default(0),
  payload:     text("payload"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy:   uuid("created_by").notNull(),
});

export type ImportBatchRow = typeof importBatches.$inferSelect;
export type ExportJobRow = typeof exportJobs.$inferSelect;
export const dataMigrationSchema = { migrations, reconciliations, importBatches, exportJobs };
