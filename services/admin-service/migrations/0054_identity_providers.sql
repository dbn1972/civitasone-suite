-- 0054_identity_providers.sql
-- Tenant IdP (directory / identity-provider) and SSO (federated sign-in) provider
-- registry for the tenant-admin IdP and SSO screens. Until now
-- GET /v1/admin/idp/providers and /v1/admin/sso/providers answered 501 because no
-- store existed.
--
-- identity_providers.providers : one row per tenant per (kind, name). `kind` is
--   'idp' (directory sync: LDAP/AD/OIDC/SAML source of users) or 'sso' (federated
--   sign-in). The client secret is NEVER stored in plaintext: only the AES-256-GCM
--   sealed blob (enc:v2:...) in client_secret_ciphertext, plus a masked last-4.
--   It is never returned by any route.
--
-- Tenant-scoped with FORCE ROW LEVEL SECURITY. No data is back-filled, so no
-- NO FORCE / FORCE wrap is needed here.
-- Rollback: DROP TABLE identity_providers.providers; DROP SCHEMA identity_providers;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS identity_providers;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS identity_providers.providers (
  id                        UUID          PRIMARY KEY,
  tenant_id                 UUID          NOT NULL,
  kind                      VARCHAR(8)    NOT NULL,
  name                      VARCHAR(120)  NOT NULL,
  protocol                  VARCHAR(16)   NOT NULL,
  entity_id                 VARCHAR(512)  NOT NULL DEFAULT '',
  endpoint                  VARCHAR(2048) NOT NULL,
  client_id                 VARCHAR(256),
  client_secret_ciphertext  TEXT,
  client_secret_last4       VARCHAR(8),
  status                    VARCHAR(16)   NOT NULL DEFAULT 'inactive',
  users_synced              INTEGER       NOT NULL DEFAULT 0,
  last_sync_at              TIMESTAMPTZ,
  version                   INTEGER       NOT NULL DEFAULT 1,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by                UUID          NOT NULL,
  updated_by                UUID          NOT NULL,
  CONSTRAINT ck_identity_providers_kind CHECK (kind IN ('idp', 'sso')),
  CONSTRAINT ck_identity_providers_protocol CHECK (protocol IN ('OIDC', 'SAML', 'LDAP', 'OAUTH2')),
  CONSTRAINT ck_identity_providers_status CHECK (status IN ('active', 'inactive', 'error')),
  CONSTRAINT ck_identity_providers_users_synced CHECK (users_synced >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_providers_tenant_kind_name
  ON identity_providers.providers (tenant_id, kind, lower(name));
CREATE INDEX IF NOT EXISTS idx_identity_providers_tenant_kind
  ON identity_providers.providers (tenant_id, kind, created_at);

ALTER TABLE identity_providers.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_providers.providers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON identity_providers.providers;
CREATE POLICY tenant_isolation_policy ON identity_providers.providers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA identity_providers TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity_providers TO admin_svc;
  END IF;
END $$;
