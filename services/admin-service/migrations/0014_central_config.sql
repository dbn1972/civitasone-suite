-- CAP-091 Central Config Management.
--   Creates the `central_config` schema + tables (config_entries,
--   config_versions, config_change_requests) with full tenant-isolation RLS
--   mirroring migration 0013 (current_tenant_id() + ENABLE/FORCE ROW LEVEL
--   SECURITY + tenant_isolation_policy USING + WITH CHECK).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP SCHEMA central_config CASCADE;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS central_config;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ── central_config.config_entries ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS central_config.config_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  key          varchar(160) NOT NULL,
  value        jsonb NOT NULL,
  sensitive    boolean NOT NULL DEFAULT false,
  encrypted    boolean NOT NULL DEFAULT false,
  description  text NOT NULL DEFAULT '',
  owner        varchar(160) NOT NULL DEFAULT '',
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS central_config_entries_tenant_key_key
  ON central_config.config_entries (tenant_id, key);

-- ── central_config.config_versions (immutable history) ──────────────────────
CREATE TABLE IF NOT EXISTS central_config.config_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  entry_id     uuid NOT NULL,
  key          varchar(160) NOT NULL,
  version      integer NOT NULL,
  value        jsonb NOT NULL,
  sensitive    boolean NOT NULL DEFAULT false,
  encrypted    boolean NOT NULL DEFAULT false,
  note         text,
  approved_by  uuid NOT NULL,
  approved_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS central_config_versions_tenant_key_version_key
  ON central_config.config_versions (tenant_id, key, version);

-- ── central_config.config_change_requests (maker-checker) ───────────────────
CREATE TABLE IF NOT EXISTS central_config.config_change_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  key              varchar(160) NOT NULL,
  proposed_value   jsonb NOT NULL,
  sensitive        boolean NOT NULL DEFAULT false,
  encrypted        boolean NOT NULL DEFAULT false,
  description      text NOT NULL DEFAULT '',
  owner            varchar(160) NOT NULL DEFAULT '',
  note             text,
  status           varchar(16) NOT NULL DEFAULT 'pending',
  proposed_by      uuid NOT NULL,
  approved_by      uuid,
  approved_at      timestamptz,
  rejected_reason  text,
  base_version     integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

DO $$ BEGIN
  ALTER TABLE central_config.config_change_requests
    ADD CONSTRAINT config_change_status_chk CHECK (status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS central_config_changes_tenant_status_idx
  ON central_config.config_change_requests (tenant_id, status);

-- ── RLS: full tenant isolation (mirrors 0006 / 0013) ────────────────────────
ALTER TABLE central_config.config_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_config.config_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON central_config.config_entries;
CREATE POLICY tenant_isolation_policy ON central_config.config_entries
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE central_config.config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_config.config_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON central_config.config_versions;
CREATE POLICY tenant_isolation_policy ON central_config.config_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE central_config.config_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_config.config_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON central_config.config_change_requests;
CREATE POLICY tenant_isolation_policy ON central_config.config_change_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
