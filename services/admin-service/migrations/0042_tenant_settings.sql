-- 0042_tenant_settings.sql
-- GAP-ADMIN-SETTINGS-01 / -05 / -06 (fp-admin-01 finish batch): the System
-- Settings screen PATCHed /v1/admin/settings/{general,email,security,
-- integrations} but no service stored or returned those values, so every save
-- 404'd and the form could never show what was configured.
--
-- tenant_settings.settings_sections : one row per tenant per section; the
--   non-secret fields live in "values" (jsonb), the SMTP password lives ONLY
--   as an AES-256-GCM sealed blob in secret_ciphertext (never in "values").
-- tenant_settings.tenant_logos      : the organisation logo (PNG/JPEG, bounded
--   size, magic-byte checked in the service) stored as bytea.
--
-- Both tables are tenant-scoped with FORCE ROW LEVEL SECURITY.
-- Rollback: DROP TABLE tenant_settings.tenant_logos;
--           DROP TABLE tenant_settings.settings_sections;
--           DROP SCHEMA tenant_settings;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS tenant_settings;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_settings.settings_sections (
  tenant_id          UUID         NOT NULL,
  section            VARCHAR(24)  NOT NULL,
  "values"           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext  TEXT,
  version            INTEGER      NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by         UUID         NOT NULL,
  CONSTRAINT pk_settings_sections PRIMARY KEY (tenant_id, section),
  CONSTRAINT ck_settings_sections_section CHECK (section IN ('general', 'email', 'security', 'integrations'))
);

CREATE TABLE IF NOT EXISTS tenant_settings.tenant_logos (
  tenant_id     UUID         NOT NULL PRIMARY KEY,
  content_type  VARCHAR(32)  NOT NULL,
  size_bytes    INTEGER      NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  data          BYTEA        NOT NULL,
  version       INTEGER      NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by    UUID         NOT NULL,
  CONSTRAINT ck_tenant_logos_type CHECK (content_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT ck_tenant_logos_size CHECK (size_bytes > 0 AND size_bytes <= 2097152)
);

ALTER TABLE tenant_settings.settings_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings.settings_sections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_settings.settings_sections;
CREATE POLICY tenant_isolation_policy ON tenant_settings.settings_sections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE tenant_settings.tenant_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings.tenant_logos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_settings.tenant_logos;
CREATE POLICY tenant_isolation_policy ON tenant_settings.tenant_logos
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Make sure the service role can use the new schema even when the environment
-- did not set default privileges for it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA tenant_settings TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant_settings TO admin_svc;
  END IF;
END $$;
