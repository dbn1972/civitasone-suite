-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0002_document_soft_delete.sql
-- Service:   meeting-service (port 3033, gateway /api/v1/meetings) — DB civitas_meeting
--
-- Purpose:
--   Add a `deleted_at` soft-delete marker to `meeting.meeting_documents` so the
--   document.remove flow can soft-delete a meeting document (steering: "DELETE =
--   soft-delete (set deleted_at). Never hard-delete user data") while preserving the
--   stored artifact + audit trail. Also adds a partial index over live (non-deleted)
--   documents per meeting for the hot list read path.
--
--   ADDITIVE and IDEMPOTENT: the column is added nullable via ADD COLUMN IF NOT EXISTS
--   (no NOT NULL backfill needed — NULL means "live"), and the index uses
--   CREATE INDEX IF NOT EXISTS. Safe to re-apply.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP INDEX IF EXISTS meeting.idx_docs_meeting_live;
--   ALTER TABLE meeting.meeting_documents DROP COLUMN IF EXISTS deleted_at;
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

ALTER TABLE meeting.meeting_documents
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Live-documents-per-meeting list read path (document repo getDocuments).
CREATE INDEX IF NOT EXISTS idx_docs_meeting_live
    ON meeting.meeting_documents (meeting_id)
    WHERE deleted_at IS NULL;
