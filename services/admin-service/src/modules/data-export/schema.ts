/**
 * data_export module — Drizzle schema. Lives in its OWN Postgres schema `data_export`.
 * DPDP Act 2023 compliant data export requests.
 */
import { pgSchema, uuid, varchar, text, timestamp, integer } from "drizzle-orm/pg-core";

export const dataExportSchema = pgSchema("data_export");

export const exportTypeEnum = dataExportSchema.enum("export_type", ["full", "module", "entity"]);
export const exportFormatEnum = dataExportSchema.enum("export_format", ["csv", "json", "pdf"]);
export const exportStatusEnum = dataExportSchema.enum("export_status", [
  "pending", "processing", "ready", "expired", "failed",
]);

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
