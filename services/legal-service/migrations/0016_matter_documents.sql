-- Migration: 0016_matter_documents
-- Purpose: Create documents schema and tables for matter-centric DMS with legal-hold support.
-- Rollback: DROP TABLE IF EXISTS documents.document_versions; DROP TABLE IF EXISTS documents.matter_documents; DROP SCHEMA IF EXISTS documents;
-- Affected services: legal-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS documents;

-- matter_documents: folders and files in a hierarchical DMS structure
CREATE TABLE IF NOT EXISTS documents.matter_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  matter_id         UUID NOT NULL,
  parent_folder_id  UUID,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('folder', 'file')),
  body              TEXT,
  file_key          TEXT,
  version           INT NOT NULL DEFAULT 1,
  legal_hold        BOOLEAN NOT NULL DEFAULT false,
  depth             INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL,
  updated_by        UUID NOT NULL
);

-- document_versions: retain all prior versions of files
CREATE TABLE IF NOT EXISTS documents.document_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  document_id       UUID NOT NULL REFERENCES documents.matter_documents(id),
  version_number    INT NOT NULL,
  body              TEXT,
  file_key          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL
);

-- Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matter_documents_tenant_matter
  ON documents.matter_documents (tenant_id, matter_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matter_documents_parent
  ON documents.matter_documents (parent_folder_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_versions_document
  ON documents.document_versions (document_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_versions_doc_ver
  ON documents.document_versions (document_id, version_number);

-- RLS enforcement
ALTER TABLE documents.matter_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.matter_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON documents.matter_documents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE documents.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.document_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON documents.document_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
