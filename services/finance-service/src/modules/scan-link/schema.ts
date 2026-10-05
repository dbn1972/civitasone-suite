/**
 * Scan-link (Finance target) — schema. Masked metadata for scanned bills/vouchers/receipts linked from
 * document-service bulk-scan. Mirrors migrations/0091_scanned_documents.sql. No PII values, no file bytes.
 */
import { uuid, text, bigint, varchar, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { paymentsSchema } from "../payments/schema.js";

export const financeScannedDocuments = paymentsSchema.table("finance_scanned_documents", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  /** finance_payment | finance_voucher | finance_bill */
  targetKind:         varchar("target_kind", { length: 24 }).notNull(),
  /** Opaque reference to the real row (no cross-module FK). */
  targetId:           uuid("target_id").notNull(),
  documentId:         uuid("document_id").notNull(),
  batchId:            uuid("batch_id").notNull(),
  fileName:           text("file_name").notNull(),
  mimeType:           varchar("mime_type", { length: 128 }),
  docType:            varchar("doc_type", { length: 64 }).notNull(),
  pageCount:          integer("page_count").notNull().default(0),
  ocrConfidence:      numeric("ocr_confidence", { precision: 5, scale: 4 }),
  piiFlags:           text("pii_flags").array().notNull().default([]),
  textPreviewMasked:  text("text_preview_masked"),
  matchedReference:   text("matched_reference"),
  matchedAmountMinor: bigint("matched_amount_minor", { mode: "bigint" }),
  linkId:             uuid("link_id").notNull(),
  linkedBy:           uuid("linked_by").notNull(),
  approvedBy:         uuid("approved_by"),
  /** linked | unlinked */
  state:              varchar("state", { length: 16 }).notNull().default("linked"),
  unlinkReason:       text("unlink_reason"),
  unlinkedBy:         uuid("unlinked_by"),
  unlinkedAt:         timestamp("unlinked_at", { withTimezone: true }),
  filedAt:            timestamp("filed_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:            integer("version").notNull().default(1),
});

export type ScannedDocumentRow = typeof financeScannedDocuments.$inferSelect;
export type ScannedDocumentInsert = typeof financeScannedDocuments.$inferInsert;

export const schema = { financeScannedDocuments };
