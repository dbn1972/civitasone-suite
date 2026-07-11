/**
 * document module — Drizzle table definition (schema `meeting`).
 *
 * Mirrors migrations/0001_meeting_core.sql `meeting.meeting_documents` column-for-column
 * (types, nullability, defaults), plus the additive `deleted_at` soft-delete column added
 * by migrations/0002_document_soft_delete.sql. The SQL migrations remain the source of
 * truth for the DDL; this file is the typed application-layer view of the table.
 *
 * A meeting document is a supporting paper / note / previous-minutes / ATR / presentation
 * attached to a meeting (and optionally to a single agenda item). Each row carries the
 * object-storage pointer (`storage_key`), a content integrity hash (`hash`, SHA-256), a
 * confidentiality `classification` (Req 15.2, 19.1) driving read access control, a
 * `version_num` + `previous_version_id` lineage for version control (Req 15.4), and a
 * retention policy (`retention_years` / `expires_at`, Req 15.7).
 *
 * Removal is a SOFT delete (steering: "DELETE = soft-delete; never hard-delete user data"):
 * the document.remove consumer sets `deleted_at` rather than issuing a DELETE, so the
 * artifact + audit trail are preserved. No column here holds PII, so there is no
 * `encryptedText()` usage (unlike the participants table).
 *
 * _Requirements: 4.1, 15.1, 15.2, 15.4, 15.7_
 */
import { pgSchema, uuid, text, integer, bigint, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

// ─── meeting_documents ─────────────────────────────────────────────────────────

export const meetingDocuments = meetingSchema.table("meeting_documents", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  meetingId:          uuid("meeting_id").notNull(),
  agendaItemId:       uuid("agenda_item_id"),
  fileName:           text("file_name").notNull(),
  mimeType:           varchar("mime_type", { length: 128 }).notNull(),
  fileSizeBytes:      bigint("file_size_bytes", { mode: "bigint" }),
  storageKey:         text("storage_key").notNull(),
  hash:               varchar("hash", { length: 64 }).notNull(),
  classification:     varchar("classification", { length: 16 }).notNull().default("internal"),
  documentType:       varchar("document_type", { length: 32 }),
  versionNum:         integer("version_num").notNull().default(1),
  previousVersionId:  uuid("previous_version_id"),
  retentionYears:     integer("retention_years").notNull().default(5),
  expiresAt:          timestamp("expires_at", { withTimezone: true }),
  /** Soft-delete marker (migrations/0002); NULL for live documents. */
  deletedAt:          timestamp("deleted_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ───────────────────────────────────────────────

export type MeetingDocumentRow    = typeof meetingDocuments.$inferSelect;
export type MeetingDocumentInsert = typeof meetingDocuments.$inferInsert;

/** Module schema map — merged into the Drizzle client in shared/db.ts as modules land. */
export const schema = { meetingDocuments };
