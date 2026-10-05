-- Migration: 0047_file_scanned_documents.sql
-- Purpose: bulk-scan link target for eOffice files (GAP-ADMIN-BULK-SCAN-02). Stores the
--          PII-masked metadata of scanned documents that document-service has filed onto an
--          eFile (written ONLY by the estab scan-link consumer; the document bytes stay in
--          document-service). Idempotent; safe to re-run.
-- Rollback: DROP TABLE IF EXISTS files.file_scanned_documents;
-- Affected services: estab-service (scan-link module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS files.file_scanned_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  file_id             uuid NOT NULL REFERENCES files.estab_files(id),
  document_id         uuid NOT NULL,             -- opaque id of document.files in document-service
  batch_id            uuid NOT NULL,
  file_name           text NOT NULL,
  mime_type           varchar(128),
  doc_type            varchar(64) NOT NULL,
  page_count          integer NOT NULL DEFAULT 0,
  ocr_confidence      numeric(5,4),
  pii_flags           text[] NOT NULL DEFAULT '{}'::text[],   -- PII TYPES only, never values
  text_preview_masked text,
  link_id             uuid NOT NULL,
  linked_by           uuid NOT NULL,
  approved_by         uuid,
  state               varchar(16) NOT NULL DEFAULT 'linked',
  unlink_reason       text,
  unlinked_by         uuid,
  unlinked_at         timestamptz,
  filed_at            timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_file_scanned_documents_link UNIQUE (tenant_id, link_id),
  CONSTRAINT chk_file_scanned_documents_state CHECK (state IN ('linked', 'unlinked')),
  CONSTRAINT chk_file_scanned_documents_pages CHECK (page_count >= 0),
  CONSTRAINT chk_file_scanned_documents_conf CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
  CONSTRAINT chk_file_scanned_documents_unlink CHECK (state <> 'unlinked' OR (unlink_reason IS NOT NULL AND length(unlink_reason) >= 5))
);

CREATE INDEX IF NOT EXISTS idx_file_scanned_documents_file
  ON files.file_scanned_documents (tenant_id, file_id, state, filed_at DESC);
-- A document can be actively linked to a given file at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_file_scanned_documents_active_doc
  ON files.file_scanned_documents (tenant_id, file_id, document_id) WHERE state = 'linked';

ALTER TABLE files.file_scanned_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.file_scanned_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON files.file_scanned_documents;
CREATE POLICY tenant_isolation ON files.file_scanned_documents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Explicit grants (idempotent; guarded so the migration also applies where the role does not exist).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estab_svc') THEN
    GRANT USAGE ON SCHEMA files TO estab_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON files.file_scanned_documents TO estab_svc;
  END IF;
END
$$;
