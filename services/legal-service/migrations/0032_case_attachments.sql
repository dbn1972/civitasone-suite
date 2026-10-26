-- Migration: 0032_case_attachments
-- Purpose: GAP-LEGAL-CASES-DETAIL-01 (owner decision #9). Affidavit attachments are
--   stored by document-service (bulk-scan pipeline: ClamAV scan, OCR, retention);
--   legal-service keeps only the case-side reference. status mirrors the
--   document-service file state: awaiting_upload -> processing -> filed, or
--   quarantined / rejected / failed. document_id is document-service's filed document.
-- Rollback: DROP TABLE IF EXISTS cases.legal_case_attachments;
-- Affected services: legal-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cases.legal_case_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  case_id       UUID NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'affidavit' CHECK (kind IN ('affidavit')),
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0),
  doc_batch_id  UUID NOT NULL,
  doc_file_id   UUID NOT NULL,
  document_id   UUID,
  status        TEXT NOT NULL DEFAULT 'awaiting_upload'
                CHECK (status IN ('awaiting_upload','processing','filed','quarantined','rejected','failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_legal_case_attachments_case
  ON cases.legal_case_attachments (tenant_id, case_id, created_at DESC);

ALTER TABLE cases.legal_case_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases.legal_case_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON cases.legal_case_attachments;
CREATE POLICY tenant_isolation ON cases.legal_case_attachments
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
