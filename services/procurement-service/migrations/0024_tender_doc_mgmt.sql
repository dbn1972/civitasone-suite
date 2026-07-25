-- Migration: 0024_tender_doc_mgmt.sql
-- Purpose: SVC-043 Tender document management. Document repository with
--          supersede-versioning (NIT/RFP/BOQ/…), corrigendum/addendum +
--          republish, and pre-bid query handling.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS tender.procurement_prebid_queries,
--           tender.procurement_tender_corrigenda, tender.procurement_tender_documents;
-- Affected services: procurement-service (tender module)
-- Requirements: SVC-043

BEGIN;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS tender.procurement_tender_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id     UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  doc_type      VARCHAR(24) NOT NULL DEFAULT 'other'
                  CHECK (doc_type IN ('nit', 'rfp', 'boq', 'corrigendum', 'addendum', 'other')),
  title         TEXT NOT NULL,
  storage_ref   TEXT NOT NULL,
  mime_type     VARCHAR(128),
  size_bytes    BIGINT,
  doc_version   INTEGER NOT NULL DEFAULT 1,
  is_current    BOOLEAN NOT NULL DEFAULT true,
  supersedes_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_tender_docs_tender ON tender.procurement_tender_documents (tender_id);
CREATE INDEX IF NOT EXISTS ix_tender_docs_tenant ON tender.procurement_tender_documents (tenant_id);

CREATE TABLE IF NOT EXISTS tender.procurement_tender_corrigenda (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id            UUID NOT NULL,
  tenant_id            UUID NOT NULL,
  corrigendum_no       INTEGER NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT,
  storage_ref          TEXT,
  new_bid_closing_date DATE,
  is_current           BOOLEAN NOT NULL DEFAULT true,
  republished          BOOLEAN NOT NULL DEFAULT false,
  published_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID NOT NULL,
  updated_by           UUID NOT NULL,
  version              INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_tender_corrigendum_no UNIQUE (tender_id, corrigendum_no)
);
CREATE INDEX IF NOT EXISTS ix_tender_corrigenda_tenant ON tender.procurement_tender_corrigenda (tenant_id);

CREATE TABLE IF NOT EXISTS tender.procurement_prebid_queries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id   UUID NOT NULL,
  tenant_id   UUID NOT NULL,
  vendor_id   UUID,
  query_no    INTEGER NOT NULL,
  question    TEXT NOT NULL,
  answer      TEXT,
  status      VARCHAR(16) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'answered', 'published')),
  published   BOOLEAN NOT NULL DEFAULT false,
  answered_by UUID,
  answered_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_prebid_query_no UNIQUE (tender_id, query_no)
);
CREATE INDEX IF NOT EXISTS ix_prebid_queries_tenant ON tender.procurement_prebid_queries (tenant_id);

-- RLS: fail-closed tenant isolation (indent.current_tenant_id()).
ALTER TABLE tender.procurement_tender_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tender_documents;
CREATE POLICY tenant_isolation ON tender.procurement_tender_documents
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

ALTER TABLE tender.procurement_tender_corrigenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_tender_corrigenda FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_tender_corrigenda;
CREATE POLICY tenant_isolation ON tender.procurement_tender_corrigenda
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

ALTER TABLE tender.procurement_prebid_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender.procurement_prebid_queries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tender.procurement_prebid_queries;
CREATE POLICY tenant_isolation ON tender.procurement_prebid_queries
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

COMMIT;
