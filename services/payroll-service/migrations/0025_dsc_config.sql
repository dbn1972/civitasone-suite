-- 0025: DSC configuration + Form 16 bulk generation job tracking
--
-- Purpose:
--   Adds per-tenant DSC (Digital Signature Certificate) configuration for signing
--   Form 16 PDFs, and a table to track bulk Form 16 generation jobs.
--
-- Rollback steps:
--   DROP INDEX IF EXISTS payroll.idx_form16_bulk_jobs_tenant;
--   DROP TABLE IF EXISTS payroll.form16_bulk_jobs;
--   DROP TABLE IF EXISTS payroll.dsc_config;
--
-- Affected services: payroll-service
-- Additive + idempotent (IF NOT EXISTS).

SET lock_timeout = '5s';

-- ── Per-tenant DSC configuration ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll.dsc_config (
  tenant_id           uuid PRIMARY KEY,
  storage_ref         text NOT NULL,                 -- S3 key: dsc/{tenantId}/signing.p12
  passphrase          text NOT NULL,                 -- encryptedText (AES-256-GCM)
  subject_cn          text NOT NULL,                 -- certificate Common Name
  serial_number       text NOT NULL,                 -- certificate serial (hex)
  not_before          timestamptz NOT NULL,
  not_after           timestamptz NOT NULL,
  sha256_fingerprint  text NOT NULL,                 -- certificate fingerprint for audit
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL
);

-- ── Form 16 bulk generation job tracking ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll.form16_bulk_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  fy                  varchar(7) NOT NULL,
  status              varchar(16) NOT NULL DEFAULT 'pending',
  total_employees     integer NOT NULL DEFAULT 0,
  generated           integer NOT NULL DEFAULT 0,
  failed              integer NOT NULL DEFAULT 0,
  storage_prefix      text,
  error_details       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  created_by          uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form16_bulk_jobs_tenant
  ON payroll.form16_bulk_jobs(tenant_id, fy);
