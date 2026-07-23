-- =============================================================================
-- Migration: 0007_evidence_schema.sql
-- Service:   inspection-service
-- Schema:    evidence
-- Purpose:   Create evidence schema with evidence_artifacts, chain_of_custody,
--            and digital_signatures tables for tamper-evident evidence
--            collection and integrity management.
-- Requirements: 7.1, 7.2, 7.5, 7.6
--
-- Rollback Strategy:
--   DROP POLICY IF EXISTS tenant_isolation ON evidence.digital_signatures;
--   DROP POLICY IF EXISTS tenant_isolation ON evidence.chain_of_custody;
--   DROP POLICY IF EXISTS tenant_isolation ON evidence.evidence_artifacts;
--   DROP INDEX IF EXISTS evidence.idx_digital_signatures_tenant_inspection;
--   DROP INDEX IF EXISTS evidence.idx_chain_of_custody_tenant_evidence;
--   DROP INDEX IF EXISTS evidence.idx_evidence_artifacts_tenant_inspection;
--   DROP TABLE IF EXISTS evidence.digital_signatures;
--   DROP TABLE IF EXISTS evidence.chain_of_custody;
--   DROP TABLE IF EXISTS evidence.evidence_artifacts;
--   DROP SCHEMA IF EXISTS evidence;
-- =============================================================================

SET lock_timeout = '5s';

-- ── Schema ────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS evidence;

-- ── Helper function for RLS ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION evidence.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── evidence_artifacts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence.evidence_artifacts (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL,
  inspection_id      uuid          NOT NULL,
  finding_id         uuid,
  sha256_hash        text          NOT NULL,
  s3_key             text          NOT NULL,
  mime_type          varchar(64)   NOT NULL,
  file_size_bytes    integer       NOT NULL,
  integrity_status   varchar(16)   NOT NULL DEFAULT 'valid'
    CHECK (integrity_status IN ('valid', 'tampered')),
  capture_latitude   numeric(10, 7),
  capture_longitude  numeric(10, 7),
  capture_timestamp  timestamptz   NOT NULL,
  device_id          text          NOT NULL,
  inspector_id       uuid          NOT NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  created_by         uuid          NOT NULL,
  version            integer       NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_tenant_inspection
  ON evidence.evidence_artifacts (tenant_id, inspection_id);

-- ── chain_of_custody ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence.chain_of_custody (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid          NOT NULL,
  evidence_id   uuid          NOT NULL
    REFERENCES evidence.evidence_artifacts(id),
  action        varchar(32)   NOT NULL,
  actor_id      uuid          NOT NULL,
  details       jsonb,
  recorded_at   timestamptz   NOT NULL DEFAULT now(),
  version       integer       NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_chain_of_custody_tenant_evidence
  ON evidence.chain_of_custody (tenant_id, evidence_id);

-- ── digital_signatures ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence.digital_signatures (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid          NOT NULL,
  inspection_id          uuid          NOT NULL,
  evidence_id            uuid
    REFERENCES evidence.evidence_artifacts(id),
  signature_image        text          NOT NULL,
  signatory_name         text          NOT NULL,
  signatory_designation  text,
  document_hash          text          NOT NULL,
  signed_at              timestamptz   NOT NULL DEFAULT now(),
  created_by             uuid          NOT NULL,
  version                integer       NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_digital_signatures_tenant_inspection
  ON evidence.digital_signatures (tenant_id, inspection_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE evidence.evidence_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.chain_of_custody   ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.digital_signatures ENABLE ROW LEVEL SECURITY;

ALTER TABLE evidence.evidence_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence.chain_of_custody   FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence.digital_signatures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON evidence.evidence_artifacts;
DROP POLICY IF EXISTS tenant_isolation ON evidence.chain_of_custody;
DROP POLICY IF EXISTS tenant_isolation ON evidence.digital_signatures;

CREATE POLICY tenant_isolation ON evidence.evidence_artifacts
  USING (tenant_id = evidence.current_tenant_id());

CREATE POLICY tenant_isolation ON evidence.chain_of_custody
  USING (tenant_id = evidence.current_tenant_id());

CREATE POLICY tenant_isolation ON evidence.digital_signatures
  USING (tenant_id = evidence.current_tenant_id());
