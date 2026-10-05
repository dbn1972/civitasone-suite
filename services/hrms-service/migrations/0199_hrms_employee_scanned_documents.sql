-- 0199_hrms_employee_scanned_documents.sql
--
-- GAP-ADMIN-BULK-SCAN-02 (H-LINK-HR): hr_employee link target of the document-service bulk-scan
-- filing flow (wire contract: packages/scan-link). One row per scanned document filed to an
-- employee's personnel file. Holds MASKED, PII-safe metadata only (types of PII found, a masked
-- text excerpt) plus the opaque document-service file id -- the file itself stays in
-- document-service and is downloaded from there. Rows are written ONLY by the
-- hrms.scan-link.request / .unlink.request consumers (queue-driven, audited). Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS employee.hrms_employee_scanned_documents;

CREATE TABLE IF NOT EXISTS employee.hrms_employee_scanned_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  employee_id         uuid NOT NULL,
  document_id         uuid NOT NULL,            -- document.files.id in document-service (opaque, no FK)
  batch_id            uuid NOT NULL,
  file_name           varchar(500) NOT NULL,
  mime_type           varchar(128),
  doc_type            varchar(64) NOT NULL,
  page_count          integer NOT NULL DEFAULT 0,
  ocr_confidence      numeric(4,3),             -- 0..1, null when OCR gave none
  pii_flags           text[] NOT NULL DEFAULT '{}',   -- PII TYPES found (never values)
  text_preview_masked varchar(500),             -- PII-masked excerpt
  link_id             uuid NOT NULL,            -- document-service bulk_scan.links.id (idempotency key)
  linked_by           uuid NOT NULL,
  approved_by         uuid,
  filed_at            timestamptz NOT NULL,
  state               varchar(16) NOT NULL DEFAULT 'linked',
  unlink_reason       text,
  unlinked_by         uuid,
  unlinked_at         timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  CONSTRAINT hrms_employee_scanned_documents_state_check CHECK (state IN ('linked', 'unlinked')),
  CONSTRAINT hrms_employee_scanned_documents_conf_check CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
  CONSTRAINT hrms_employee_scanned_documents_unlink_check CHECK (state = 'linked' OR (unlink_reason IS NOT NULL AND length(btrim(unlink_reason)) >= 5)),
  CONSTRAINT hrms_employee_scanned_documents_link_uq UNIQUE (tenant_id, link_id)
);

CREATE INDEX IF NOT EXISTS hrms_employee_scanned_documents_emp_idx
  ON employee.hrms_employee_scanned_documents (tenant_id, employee_id, state, filed_at DESC);
-- A document can be actively linked to an employee at most once (re-link after an unlink is a new link_id).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_employee_scanned_documents_active_uq
  ON employee.hrms_employee_scanned_documents (tenant_id, employee_id, document_id) WHERE state = 'linked';

ALTER TABLE employee.hrms_employee_scanned_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_scanned_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_employee_scanned_documents_tenant_isolation ON employee.hrms_employee_scanned_documents;
CREATE POLICY hrms_employee_scanned_documents_tenant_isolation ON employee.hrms_employee_scanned_documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON employee.hrms_employee_scanned_documents TO hrms_svc;
