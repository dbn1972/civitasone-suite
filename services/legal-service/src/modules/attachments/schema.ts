import { uuid, text, integer, bigint, timestamp } from "drizzle-orm/pg-core";
import { casesSchema } from "../cases/schema.js";

/**
 * GAP-LEGAL-CASES-DETAIL-01 (owner decision #9): case-side reference to a file held by
 * document-service (affidavits). Bytes, virus scan, OCR and retention live there.
 */
export const legalCaseAttachments = casesSchema.table("legal_case_attachments", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  caseId:     uuid("case_id").notNull(),
  kind:       text("kind").notNull().default("affidavit"),
  fileName:   text("file_name").notNull(),
  mimeType:   text("mime_type").notNull(),
  sizeBytes:  bigint("size_bytes", { mode: "number" }).notNull(),
  docBatchId: uuid("doc_batch_id").notNull(),
  docFileId:  uuid("doc_file_id").notNull(),
  documentId: uuid("document_id"),
  status:     text("status").notNull().default("awaiting_upload"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type AttachmentRow = typeof legalCaseAttachments.$inferSelect;
export const schema = { legalCaseAttachments };
