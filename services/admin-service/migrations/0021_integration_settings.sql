-- Integration Settings registry (external-endpoint config store).
--   Creates the `integration_settings` schema + tables (integration_settings,
--   integration_setting_changes) with full tenant-isolation RLS mirroring
--   migration 0014 (current_tenant_id() + ENABLE/FORCE ROW LEVEL SECURITY +
--   tenant_isolation_policy USING + WITH CHECK).
-- Secrets are stored ONLY as AES-256-GCM ciphertext (secret_ciphertext); the
-- plaintext never touches the database.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP SCHEMA integration_settings CASCADE;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS integration_settings;

-- current_tenant_id() is created by earlier migrations (0006/0013/0014). Only
-- define it if it is somehow missing, so this migration never needs to own it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

-- ── integration_settings.integration_settings (live, applied config) ─────────
CREATE TABLE IF NOT EXISTS integration_settings.integration_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  provider          varchar(40) NOT NULL,
  env_scope         varchar(16) NOT NULL,
  enabled           boolean NOT NULL DEFAULT false,
  endpoint_url      text NOT NULL DEFAULT '',
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext text,
  secret_last4      varchar(8),
  status            varchar(16) NOT NULL DEFAULT 'unconfigured',
  last_tested_at    timestamptz,
  last_error        text,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_settings_tenant_provider_env_key
  ON integration_settings.integration_settings (tenant_id, provider, env_scope);

DO $$ BEGIN
  ALTER TABLE integration_settings.integration_settings
    ADD CONSTRAINT integration_settings_status_chk CHECK (status IN ('unconfigured','connected','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE integration_settings.integration_settings
    ADD CONSTRAINT integration_settings_env_chk CHECK (env_scope IN ('dev','staging','prod'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── integration_settings.integration_setting_changes (maker-checker) ─────────
CREATE TABLE IF NOT EXISTS integration_settings.integration_setting_changes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  provider          varchar(40) NOT NULL,
  env_scope         varchar(16) NOT NULL,
  enabled           boolean NOT NULL DEFAULT false,
  endpoint_url      text NOT NULL DEFAULT '',
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext text,
  secret_last4      varchar(8),
  secret_changed    boolean NOT NULL DEFAULT false,
  note              text,
  status            varchar(16) NOT NULL DEFAULT 'pending',
  proposed_by       uuid NOT NULL,
  approved_by       uuid,
  approved_at       timestamptz,
  rejected_reason   text,
  base_version      integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE integration_settings.integration_setting_changes
    ADD CONSTRAINT integration_change_status_chk CHECK (status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS integration_setting_changes_tenant_status_idx
  ON integration_settings.integration_setting_changes (tenant_id, status);

-- ── RLS: full tenant isolation (mirrors 0014) ────────────────────────────────
ALTER TABLE integration_settings.integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_settings.integration_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON integration_settings.integration_settings;
CREATE POLICY tenant_isolation_policy ON integration_settings.integration_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE integration_settings.integration_setting_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_settings.integration_setting_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON integration_settings.integration_setting_changes;
CREATE POLICY tenant_isolation_policy ON integration_settings.integration_setting_changes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
