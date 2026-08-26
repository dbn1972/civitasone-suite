-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0009_document_previous_version_fk.sql
-- Service:   meeting-service (port 3033, gateway /api/v1/meetings) — DB civitas_meeting
--
-- Purpose:
--   meeting.meeting_documents.previous_version_id has NO foreign-key constraint
--   (schema/migration review finding) even though the sibling meeting_id / agenda_item_id
--   columns on the SAME table both carry real FKs (migrations/0001_meeting_core.sql).
--   document/consumer.ts handleDocumentUpload looks up the named predecessor to compute
--   version_num, but a miss silently falls back to version_num = 1 while STILL persisting
--   the caller-supplied previous_version_id verbatim — with no DB-level backstop this
--   produces a row that presents as an original (version 1) yet points at nothing.
--   document/repo.ts getVersionHistory's ancestor walk then hits that miss and silently
--   truncates the lineage chain rather than surfacing the inconsistency.
--
--   Data hygiene FIRST (idempotent, safe to re-run): any EXISTING row whose
--   previous_version_id does not resolve to a real meeting_documents row is nulled out
--   before the constraint is added, so the ALTER TABLE below cannot fail against
--   pre-existing dangling data in any environment this migration runs in.
--
--   ADDITIVE and IDEMPOTENT: the constraint is added inside a DO block guarded by a
--   pg_constraint existence check (Postgres has no native ADD CONSTRAINT IF NOT EXISTS).
--   Self-referential FK, ON DELETE SET NULL — chosen (over CASCADE/RESTRICT) so a version
--   chain can never block deleting an old row it happens to point at; document.remove is a
--   soft-delete today, but this also protects any future hard-delete / retention-purge path
--   from being blocked by a version lineage reference.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   ALTER TABLE meeting.meeting_documents DROP CONSTRAINT IF EXISTS meeting_documents_previous_version_id_fkey;
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- Data hygiene: null out any pre-existing dangling previous_version_id (a self-reference
-- whose predecessor row does not exist) before the FK constraint can be added.
UPDATE meeting.meeting_documents d
SET previous_version_id = NULL
WHERE d.previous_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM meeting.meeting_documents p WHERE p.id = d.previous_version_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meeting_documents_previous_version_id_fkey'
  ) THEN
    ALTER TABLE meeting.meeting_documents
      ADD CONSTRAINT meeting_documents_previous_version_id_fkey
      FOREIGN KEY (previous_version_id) REFERENCES meeting.meeting_documents(id)
      ON DELETE SET NULL;
  END IF;
END $$;
