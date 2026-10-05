-- 0091_scanned_documents.sql
-- GAP-ADMIN-BULK-SCAN-02 (Finance link target): masked metadata for scanned bills / vouchers / receipts that
-- document-service (bulk-scan) has linked to a finance payment, voucher (GL journal) or bill. Written ONLY by the
-- scan-link consumer (finance.scan-link.request / .unlink.request); the actual file stays in document-service.
-- No PII values are stored: pii_flags are TYPES, text_preview_masked is already masked upstream.
-- target_id is an opaque reference to the real row (no cross-module FK, per L2).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE payments.finance_scanned_documents; DROP INDEX the three idx_*_refnorm indexes.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS payments.finance_scanned_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  target_kind         varchar(24) NOT NULL,
  target_id           uuid NOT NULL,
  document_id         uuid NOT NULL,
  batch_id            uuid NOT NULL,
  file_name           text NOT NULL,
  mime_type           varchar(128),
  doc_type            varchar(64) NOT NULL,
  page_count          integer NOT NULL DEFAULT 0,
  ocr_confidence      numeric(5,4),
  pii_flags           text[] NOT NULL DEFAULT '{}',
  text_preview_masked text,
  matched_reference   text,
  matched_amount_minor bigint,
  link_id             uuid NOT NULL,
  linked_by           uuid NOT NULL,
  approved_by         uuid,
  state               varchar(16) NOT NULL DEFAULT 'linked',
  unlink_reason       text,
  unlinked_by         uuid,
  unlinked_at         timestamptz,
  filed_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT finance_scanned_documents_kind_chk CHECK (target_kind IN ('finance_payment', 'finance_voucher', 'finance_bill')),
  CONSTRAINT finance_scanned_documents_state_chk CHECK (state IN ('linked', 'unlinked')),
  CONSTRAINT finance_scanned_documents_unlink_chk CHECK (state <> 'unlinked' OR (unlink_reason IS NOT NULL AND char_length(unlink_reason) >= 5)),
  CONSTRAINT finance_scanned_documents_link_uq UNIQUE (tenant_id, link_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_scanned_documents_target
  ON payments.finance_scanned_documents (tenant_id, target_kind, target_id, state);
CREATE INDEX IF NOT EXISTS idx_finance_scanned_documents_document
  ON payments.finance_scanned_documents (tenant_id, document_id);

ALTER TABLE payments.finance_scanned_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_scanned_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_scanned_documents;
CREATE POLICY tenant_isolation_policy ON payments.finance_scanned_documents
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- Normalised-reference indexes for GET /internal/v1/scan-link/lookup. The expression MUST stay identical to
-- the one in modules/scan-link/repo.ts (lower-cased, everything except [a-z0-9] removed) or the planner ignores them.
CREATE INDEX IF NOT EXISTS idx_finance_bills_refnorm
  ON payments.finance_bills (tenant_id, (regexp_replace(lower(bill_no), '[^a-z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_finance_payments_refnorm
  ON payments.finance_payments (tenant_id, (regexp_replace(lower(coalesce(eft_ref, '')), '[^a-z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_finance_journals_refnorm
  ON gl.finance_journals (tenant_id, (regexp_replace(lower(voucher_no), '[^a-z0-9]', '', 'g')));

-- Explicit grants (idempotent; guarded so the migration also applies where the role does not exist).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT USAGE ON SCHEMA payments TO finance_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON payments.finance_scanned_documents TO finance_svc;
  END IF;
END
$$;
