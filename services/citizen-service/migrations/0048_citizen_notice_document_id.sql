-- citizen-service migration 0048 - D1 (CITIZEN-NOTICES-05): optional document-service attachment on notices.
--
-- engagement.citizen_notices.document_id references a file in document-service
-- (documents.files.id). Cross-service, so deliberately NO foreign key: the id is an
-- opaque pointer, nullable, and existing rows stay NULL (no attachment).
--
-- Additive + idempotent. DDL only (no DML), so no NO FORCE / FORCE wrap needed.

ALTER TABLE engagement.citizen_notices
  ADD COLUMN IF NOT EXISTS document_id uuid;
