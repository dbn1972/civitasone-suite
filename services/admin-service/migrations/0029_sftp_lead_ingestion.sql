-- Migration: 0029_sftp_lead_ingestion.sql
-- Purpose: BRD §9 #12 External Lead Sources + §7.1 LM-005 — SFTP lead-ingestion
--          bookkeeping. Two tables in a dedicated `lead_ingestion` schema:
--            * sftp_ingestion_runs   — one row per file-sweep (audit + operator visibility)
--            * sftp_ingested_files   — idempotency ledger; UNIQUE(tenant,provider,env,filename,checksum)
--          + list_sftp_lead_source_tenants() SECURITY DEFINER for the cross-tenant
--            scheduler (REVOKE FROM PUBLIC, GRANT to admin_svc — AS-004/DM lesson).
-- RLS: full tenant isolation, mirroring 0021_integration_settings (ENABLE + FORCE +
--      current_tenant_id() USING/WITH CHECK).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP SCHEMA lead_ingestion CASCADE;
--           DROP FUNCTION IF EXISTS list_sftp_lead_source_tenants();
-- Affected services: admin-service (lead-ingestion module).

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS lead_ingestion;

-- current_tenant_id() is created by earlier migrations (0006/0013/0014); guard
-- so this migration never needs to own it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

-- ── lead_ingestion.sftp_ingestion_runs (one row per file-sweep) ──────────────
CREATE TABLE IF NOT EXISTS lead_ingestion.sftp_ingestion_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  provider     varchar(40) NOT NULL DEFAULT 'sftp',
  env          varchar(16) NOT NULL,
  status       varchar(16) NOT NULL DEFAULT 'running',
  files_seen   integer NOT NULL DEFAULT 0,
  rows_total   integer NOT NULL DEFAULT 0,
  rows_created integer NOT NULL DEFAULT 0,
  rows_failed  integer NOT NULL DEFAULT 0,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE lead_ingestion.sftp_ingestion_runs
    ADD CONSTRAINT sftp_ingestion_runs_status_chk
    CHECK (status IN ('running','succeeded','failed','partial'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS sftp_ingestion_runs_tenant_started_idx
  ON lead_ingestion.sftp_ingestion_runs (tenant_id, started_at DESC);

-- ── lead_ingestion.sftp_ingested_files (idempotency ledger) ──────────────────
CREATE TABLE IF NOT EXISTS lead_ingestion.sftp_ingested_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  provider    varchar(40) NOT NULL DEFAULT 'sftp',
  env         varchar(16) NOT NULL,
  filename    text NOT NULL,
  checksum    varchar(64) NOT NULL,
  size_bytes  bigint NOT NULL DEFAULT 0,
  run_id      uuid,
  ingested_at timestamptz NOT NULL DEFAULT now()
);
-- The idempotency key: a re-seen file with the same content (same checksum) is
-- skipped; a changed file (new checksum) is a new, ingestible artefact.
CREATE UNIQUE INDEX IF NOT EXISTS sftp_ingested_files_key
  ON lead_ingestion.sftp_ingested_files (tenant_id, provider, env, filename, checksum);

-- ── RLS: full tenant isolation (mirrors 0021) ───────────────────────────────
ALTER TABLE lead_ingestion.sftp_ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_ingestion.sftp_ingestion_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lead_ingestion.sftp_ingestion_runs;
CREATE POLICY tenant_isolation_policy ON lead_ingestion.sftp_ingestion_runs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE lead_ingestion.sftp_ingested_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_ingestion.sftp_ingested_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lead_ingestion.sftp_ingested_files;
CREATE POLICY tenant_isolation_policy ON lead_ingestion.sftp_ingested_files
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── cross-tenant discovery for the scheduler ─────────────────────────────────
-- Returns every tenant that has an ENABLED sftp connector flagged as a lead
-- source (config.leadSource = true). SECURITY DEFINER so the NOBYPASSRLS worker
-- role can enumerate across tenants; the per-tenant work then runs under the
-- tenant GUC so each tenant only ever sees its own rows.
CREATE OR REPLACE FUNCTION list_sftp_lead_source_tenants()
RETURNS TABLE(tenant_id uuid, env varchar)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integration_settings, pg_temp
AS $fn$
  SELECT DISTINCT s.tenant_id, s.env_scope
    FROM integration_settings.integration_settings s
   WHERE s.provider = 'sftp'
     AND s.enabled = true
     AND COALESCE((s.config->>'leadSource')::boolean, false) = true;
$fn$;

REVOKE ALL ON FUNCTION list_sftp_lead_source_tenants() FROM PUBLIC;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA lead_ingestion TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA lead_ingestion TO admin_svc;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA lead_ingestion TO admin_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA lead_ingestion GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_svc;
    GRANT EXECUTE ON FUNCTION list_sftp_lead_source_tenants() TO admin_svc;
  END IF;
END $g$;
