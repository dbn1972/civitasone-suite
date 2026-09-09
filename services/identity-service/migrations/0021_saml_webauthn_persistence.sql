-- 0021_saml_webauthn_persistence.sql — DOM-005: close two fabricated-success
-- gaps in identity-service.
--
-- WHY:
--   1. saml/routes.ts PUT /v1/identity/saml/config returned 202 "saved" and
--      GET echoed process.env vars — no per-tenant config was ever written or
--      read. Every "save" was silently discarded.
--   2. webauthn/routes.ts DELETE /credentials/:id returned 204 with no
--      ownership check and no actual deletion — a no-op impersonating success.
--
-- This migration adds real, tenant-scoped, RLS-protected storage for both so
-- the fixes in saml/repo.ts and webauthn/repo.ts have somewhere honest to
-- read and write. Additive + idempotent, mirrors 0011 (table shape) +
-- 0013 (RLS policy shape).

-- ── SAML per-tenant SP configuration ────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS saml;

CREATE TABLE IF NOT EXISTS saml.tenant_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  entity_id         VARCHAR(512) NOT NULL,
  acs_url           VARCHAR(2048) NOT NULL,
  idp_metadata_url  VARCHAR(2048),
  idp_metadata_xml  TEXT,
  sign_requests     BOOLEAN NOT NULL DEFAULT true,
  name_id_format    VARCHAR(16) NOT NULL DEFAULT 'email', -- email | persistent | transient
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL,
  updated_by        UUID NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1
);
-- Exactly one SAML config per tenant; PUT is an upsert keyed on this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saml_tenant_config_tenant ON saml.tenant_config (tenant_id);

-- ── WebAuthn credentials ─────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS webauthn;

CREATE TABLE IF NOT EXISTS webauthn.credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  -- owner: the only identity allowed to delete this row. Never taken from a
  -- client-supplied field — always ctx.actorId from the authenticated
  -- request context.
  user_id         UUID NOT NULL,
  credential_id   VARCHAR(1024) NOT NULL, -- base64url authenticator credential id
  public_key      TEXT NOT NULL,
  sign_count      BIGINT NOT NULL DEFAULT 0,
  device_name     VARCHAR(200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webauthn_credentials_cred_id ON webauthn.credentials (tenant_id, credential_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_owner ON webauthn.credentials (tenant_id, user_id);

-- ── RLS (mirrors 0013_rls_full_tenant_isolation.sql) ────────────────────────
ALTER TABLE saml.tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE saml.tenant_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON saml.tenant_config;
CREATE POLICY tenant_isolation_policy ON saml.tenant_config
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

ALTER TABLE webauthn.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn.credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON webauthn.credentials;
CREATE POLICY tenant_isolation_policy ON webauthn.credentials
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());
