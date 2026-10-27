/**
 * data_export module — Drizzle schema. Lives in its OWN Postgres schema `data_export`.
 * DPDP Act 2023 compliant data export requests.
 */
import { pgSchema, uuid, varchar, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const dataExportSchema = pgSchema("data_export");

export const exportTypeEnum = dataExportSchema.enum("export_type", ["full", "module", "entity"]);
export const exportFormatEnum = dataExportSchema.enum("export_format", ["csv", "json", "pdf"]);
export const exportStatusEnum = dataExportSchema.enum("export_status", [
  "pending", "processing", "ready", "expired", "failed",
]);

export interface ExportFile {
  entity: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  rowCount: number;
}

export const exportRequests = dataExportSchema.table("export_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  type: exportTypeEnum("type").notNull(),
  moduleFilter: varchar("module_filter", { length: 100 }),
  format: exportFormatEnum("format").notNull(),
  status: exportStatusEnum("status").notNull().default("pending"),
  downloadUrl: text("download_url"),
  fileSizeBytes: integer("file_size_bytes"),
  /** Owner decision #22: single-entity exports name the entity here. */
  entityId: varchar("entity_id", { length: 160 }),
  /** Owner decision #22: the stored files (key per file; links are signed on download). */
  files: jsonb("files").$type<ExportFile[]>().notNull().default([]),
  /** Short machine reason for a failed export (never raw error text). */
  failureReason: varchar("failure_reason", { length: 64 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ExportRequestRow = typeof exportRequests.$inferSelect;
export type ExportRequestInsert = typeof exportRequests.$inferInsert;

export const schema = { exportRequests };
