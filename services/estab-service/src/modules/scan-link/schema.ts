import { uuid, text, varchar, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { filesSchema } from "../files/schema.js";

/**
 * PII-masked metadata of scanned documents filed onto an eOffice file by the
 * document-service bulk-scan pipeline. Written ONLY by the scan-link consumer
 * (migration 0047). The document bytes stay in document-service.
 */
export const fileScannedDocuments = filesSchema.table("file_scanned_documents", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  fileId:            uuid("file_id").notNull(),
  documentId:        uuid("document_id").notNull(),
  batchId:           uuid("batch_id").notNull(),
  fileName:          text("file_name").notNull(),
  mimeType:          varchar("mime_type", { length: 128 }),
  docType:           varchar("doc_type", { length: 64 }).notNull(),
  pageCount:         integer("page_count").notNull().default(0),
  ocrConfidence:     numeric("ocr_confidence", { precision: 5, scale: 4 }),
  piiFlags:          text("pii_flags").array().notNull().default(sql`'{}'::text[]`),
  textPreviewMasked: text("text_preview_masked"),
  linkId:            uuid("link_id").notNull(),
  linkedBy:          uuid("linked_by").notNull(),
  approvedBy:        uuid("approved_by"),
  state:             varchar("state", { length: 16 }).notNull().default("linked"),
  unlinkReason:      text("unlink_reason"),
  unlinkedBy:        uuid("unlinked_by"),
  unlinkedAt:        timestamp("unlinked_at", { withTimezone: true }),
  filedAt:           timestamp("filed_at", { withTimezone: true }).notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export type ScannedDocumentRow = typeof fileScannedDocuments.$inferSelect;
export type ScannedDocumentInsert = typeof fileScannedDocuments.$inferInsert;

export const schema = { fileScannedDocuments };
