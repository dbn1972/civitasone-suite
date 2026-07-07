/**
 * exports/schema.ts — Drizzle table definition for export_jobs.
 *
 * Enhanced schema with fileKey, expiresAt, fileSizeBytes, error columns
 * to support full export lifecycle with S3 storage and presigned URLs.
 */
import { pgSchema, uuid, varchar, integer, timestamp, bigint, text } from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

export const exportJobs = analyticsSchema.table("export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  queryRunId: uuid("query_run_id"),
  format: varchar("format", { length: 8 }).notNull().default("csv"), // csv | json
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | processing | completed | failed
  fileKey: text("file_key"), // S3 object key
  downloadUrl: text("download_url"), // presigned URL
  expiresAt: timestamp("expires_at", { withTimezone: true }), // URL expiry (24h from generation)
  fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }), // file size enforced ≤ 50MB
  error: text("error"), // failure reason
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ExportJobRow = typeof exportJobs.$inferSelect;
export type ExportJobInsert = typeof exportJobs.$inferInsert;

export type ExportJobView = {
  id: string;
  tenantId: string;
  queryRunId: string | null;
  format: string;
  status: string;
  fileKey: string | null;
  downloadUrl: string | null;
  expiresAt: Date | null;
  fileSizeBytes: bigint | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export const schema = { exportJobs };
