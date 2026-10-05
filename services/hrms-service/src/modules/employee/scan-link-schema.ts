import { uuid, text, integer, varchar, numeric, timestamp } from "drizzle-orm/pg-core";
import { employeeSchema } from "./schema.js";

/**
 * GAP-ADMIN-BULK-SCAN-02: scanned documents filed to an employee personnel file by the
 * document-service bulk-scan flow (wire contract: packages/scan-link). Masked metadata only.
 */
export const hrmsEmployeeScannedDocuments = employeeSchema.table("hrms_employee_scanned_documents", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  employeeId:        uuid("employee_id").notNull(),
  documentId:        uuid("document_id").notNull(),
  batchId:           uuid("batch_id").notNull(),
  fileName:          varchar("file_name", { length: 500 }).notNull(),
  mimeType:          varchar("mime_type", { length: 128 }),
  docType:           varchar("doc_type", { length: 64 }).notNull(),
  pageCount:         integer("page_count").notNull().default(0),
  ocrConfidence:     numeric("ocr_confidence", { precision: 4, scale: 3 }),
  piiFlags:          text("pii_flags").array().notNull().default([]),
  textPreviewMasked: varchar("text_preview_masked", { length: 500 }),
  linkId:            uuid("link_id").notNull(),
  linkedBy:          uuid("linked_by").notNull(),
  approvedBy:        uuid("approved_by"),
  filedAt:           timestamp("filed_at", { withTimezone: true }).notNull(),
  state:             varchar("state", { length: 16 }).notNull().default("linked"),
  unlinkReason:      text("unlink_reason"),
  unlinkedBy:        uuid("unlinked_by"),
  unlinkedAt:        timestamp("unlinked_at", { withTimezone: true }),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
});

export type ScannedDocumentRow = typeof hrmsEmployeeScannedDocuments.$inferSelect;

export const scanLinkSchema = { hrmsEmployeeScannedDocuments };
