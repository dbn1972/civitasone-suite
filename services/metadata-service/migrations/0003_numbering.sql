-- Migration: 0003_numbering.sql
-- Purpose: Generic, config-driven unique numbering & reference generation (CAP-032).
--   number_formats   — tenant-scoped named formats (prefix/FY/width/separator/reset policy),
--                       maker-checker: draft -> active, creator cannot self-publish.
--   number_sequences — gapless per (tenant, format_key, reset-bucket) counter store.
-- Rollback: DROP TABLE IF EXISTS metadata.number_sequences, metadata.number_formats;
-- Safety: additive, idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS metadata;

-- ── Number Formats ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata.number_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  format_key VARCHAR(128) NOT NULL,          -- e.g. "procurement.po", "citizen.cert"
  label VARCHAR(256) NOT NULL,
  prefix VARCHAR(32) NOT NULL DEFAULT '',
  embed_financial_year BOOLEAN NOT NULL DEFAULT true,
  fy_start_month INT NOT NULL DEFAULT 4,     -- India FY starts in April
  counter_width INT NOT NULL DEFAULT 6,
  separator VARCHAR(4) NOT NULL DEFAULT '/',
  reset_policy VARCHAR(16) NOT NULL DEFAULT 'yearly',  -- never | yearly | monthly
  status VARCHAR(16) NOT NULL DEFAULT 'draft',         -- draft | active | disabled
  published_at TIMESTAMPTZ,
  published_by UUID,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  CONSTRAINT number_formats_reset_policy_chk CHECK (reset_policy IN ('never','yearly','monthly')),
  CONSTRAINT number_formats_status_chk CHECK (status IN ('draft','active','disabled')),
  CONSTRAINT number_formats_fy_month_chk CHECK (fy_start_month BETWEEN 1 AND 12),
  CONSTRAINT number_formats_width_chk CHECK (counter_width BETWEEN 1 AND 18),
  UNIQUE (tenant_id, format_key)
);

ALTER TABLE metadata.number_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.number_formats FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metadata.number_formats;
CREATE POLICY tenant_isolation ON metadata.number_formats
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Number Sequences (gapless counter store) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata.number_sequences (
  tenant_id UUID NOT NULL,
  format_key VARCHAR(128) NOT NULL,
  bucket VARCHAR(16) NOT NULL,               -- reset-period bucket: 'ALL' | '2026-27' | '2026-07'
  current_value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, format_key, bucket) -- also the ON CONFLICT target for gapless allocation
);

ALTER TABLE metadata.number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata.number_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metadata.number_sequences;
CREATE POLICY tenant_isolation ON metadata.number_sequences
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
