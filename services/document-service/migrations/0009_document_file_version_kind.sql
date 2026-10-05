-- Purpose: a filed bulk-scan document carries renditions next to the original (searchable PDF, OCR text, structured JSON).
--          document.file_versions gets a `kind` column so each rendition of version N is its own row
--          (kind = original | searchable_pdf | ocr_text | structured_json). Existing rows are `original`.
-- Rollback: ALTER TABLE document.file_versions DROP COLUMN kind; (rendition rows must be deleted first)
-- Affected services: document-service (modules/files schema, written via the bulk-scan FilingPort adapter)
-- Additive and idempotent. Safe to re-run. Requires 0001.
SET lock_timeout = '5s';

ALTER TABLE document.file_versions ADD COLUMN IF NOT EXISTS kind varchar(24) NOT NULL DEFAULT 'original';
DO $$ BEGIN
  ALTER TABLE document.file_versions
    ADD CONSTRAINT document_file_versions_kind_chk CHECK (kind IN ('original', 'searchable_pdf', 'ocr_text', 'structured_json'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- one row per (file, version, kind): makes filing idempotent under redelivery
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_file_versions_kind ON document.file_versions(file_id, version, kind);
