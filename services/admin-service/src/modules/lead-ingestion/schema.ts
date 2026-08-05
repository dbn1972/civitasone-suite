/**
 * lead-ingestion module — Drizzle schema.
 *
 * BRD §9 #12 (External Lead Sources) + §7.1 LM-005. Bookkeeping for the SFTP
 * lead-ingestion connector: one row per file-sweep (`sftp_ingestion_runs`) and
 * an idempotency ledger of already-ingested files (`sftp_ingested_files`).
 *
 * Lives in its OWN Postgres schema `lead_ingestion` (created by migration 0029)
 * with full tenant-isolation RLS mirroring integration_settings (0021).
 */
import { pgSchema, uuid, varchar, text, integer, bigint, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const leadIngestionSchema = pgSchema("lead_ingestion");

/** One SFTP file-sweep for a tenant×env connector. */
export const sftpIngestionRuns = leadIngestionSchema.table("sftp_ingestion_runs", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  provider:    varchar("provider", { length: 40 }).notNull().default("sftp"),
  env:         varchar("env", { length: 16 }).notNull(),
  // running | succeeded | failed | partial
  status:      varchar("status", { length: 16 }).notNull().default("running"),
  filesSeen:   integer("files_seen").notNull().default(0),
  rowsTotal:   integer("rows_total").notNull().default(0),
  rowsCreated: integer("rows_created").notNull().default(0),
  rowsFailed:  integer("rows_failed").notNull().default(0),
  error:       text("error"),
  startedAt:   timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt:  timestamp("finished_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantStartedIdx: index("sftp_ingestion_runs_tenant_started_idx").on(t.tenantId, t.startedAt),
}));

/** Idempotency ledger: a (tenant,provider,env,filename,checksum) is ingested once. */
export const sftpIngestedFiles = leadIngestionSchema.table("sftp_ingested_files", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  provider:   varchar("provider", { length: 40 }).notNull().default("sftp"),
  env:        varchar("env", { length: 16 }).notNull(),
  filename:   text("filename").notNull(),
  checksum:   varchar("checksum", { length: 64 }).notNull(),
  sizeBytes:  bigint("size_bytes", { mode: "number" }).notNull().default(0),
  runId:      uuid("run_id"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  key: uniqueIndex("sftp_ingested_files_key").on(t.tenantId, t.provider, t.env, t.filename, t.checksum),
}));

export type SftpIngestionRunRow    = typeof sftpIngestionRuns.$inferSelect;
export type SftpIngestionRunInsert = typeof sftpIngestionRuns.$inferInsert;
export type SftpIngestedFileRow    = typeof sftpIngestedFiles.$inferSelect;
export type SftpIngestedFileInsert = typeof sftpIngestedFiles.$inferInsert;

export const schema = { sftpIngestionRuns, sftpIngestedFiles };
