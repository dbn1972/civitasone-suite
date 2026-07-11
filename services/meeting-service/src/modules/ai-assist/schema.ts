/**
 * AI-assist module — typed Drizzle view of `meeting.meeting_documents`.
 *
 * The AI-assist flows persist two kinds of artifact into the shared `meeting.meeting_documents`
 * table (migrations/0001_meeting_core.sql):
 *   - the accepted transcript          → `document_type = 'transcript'`
 *   - AI-extracted action candidates   → `document_type = 'ai_action_suggestions'` (pending human
 *                                          confirmation; NEVER live action items — see domain.ts P37)
 *
 * The document module (task 16) owns the write/read HTTP surface for `meeting_documents`; this
 * binding is the minimal typed view AI-assist needs to store/read its own artifacts without a
 * cross-module import dependency. It mirrors the migration column-for-column (the migration is
 * the source of truth for the DDL). Two Drizzle `table()` bindings of the same physical table are
 * independent typed views — neither is registered in shared/db.ts, so there is no runtime clash.
 *
 * _Requirements: 17.1, 17.4_
 */
import { pgSchema, uuid, text, integer, varchar, bigint, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/** AI-owned `document_type` values written into `meeting.meeting_documents`. */
export const AI_DOC_TYPE_TRANSCRIPT = "transcript" as const;
export const AI_DOC_TYPE_ACTION_SUGGESTIONS = "ai_action_suggestions" as const;

/**
 * `meeting.meeting_documents` — file/artifact metadata for a meeting. AI-assist stores the
 * transcript and the action-candidate artifact here (content bytes live in object storage,
 * referenced by `storageKey`). `hash` is the SHA-256 of the stored content for tamper-evidence.
 */
export const meetingDocuments = meetingSchema.table("meeting_documents", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  meetingId:         uuid("meeting_id").notNull(),
  agendaItemId:      uuid("agenda_item_id"),
  fileName:          text("file_name").notNull(),
  mimeType:          varchar("mime_type", { length: 128 }).notNull(),
  fileSizeBytes:     bigint("file_size_bytes", { mode: "number" }),
  storageKey:        text("storage_key").notNull(),
  hash:              varchar("hash", { length: 64 }).notNull(),
  classification:    varchar("classification", { length: 16 }).notNull().default("internal"),
  documentType:      varchar("document_type", { length: 32 }),
  versionNum:        integer("version_num").notNull().default(1),
  previousVersionId: uuid("previous_version_id"),
  retentionYears:    integer("retention_years").notNull().default(5),
  expiresAt:         timestamp("expires_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

/** Row types inferred from the table for repo/consumer layers. */
export type MeetingDocumentRow = typeof meetingDocuments.$inferSelect;
export type MeetingDocumentInsert = typeof meetingDocuments.$inferInsert;
