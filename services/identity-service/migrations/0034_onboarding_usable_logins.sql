-- 0034_onboarding_usable_logins.sql
-- Purpose: usable logins on user create (identity-login-onboarding).
--   users.tenant_onboarding_settings : per-tenant switch. DEFAULT OFF, so a tenant with no row keeps today's
--     create behaviour exactly (bare federated realm user, no default role, no set-password step).
--   users.password_setup_tokens      : short-lived, single-use set-your-password tokens for the no-mail path.
--     Only the SHA-256 of the secret is stored; the secret is shown to the admin once. No password is ever stored.
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout. Additive only.
-- Rollback: migrations/down/0034_onboarding_usable_logins.sql
-- Affected services: identity-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS users.tenant_onboarding_settings (
  tenant_id      UUID PRIMARY KEY,
  usable_logins  BOOLEAN NOT NULL DEFAULT FALSE,
  password_mode  VARCHAR(8) NOT NULL DEFAULT 'link',
  updated_by     UUID NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_onboarding_settings_mode_check CHECK (password_mode IN ('email', 'link', 'off'))
);

CREATE TABLE IF NOT EXISTS users.password_setup_tokens (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  token_hash   CHAR(64) NOT NULL,
  created_by   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  CONSTRAINT password_setup_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT password_setup_tokens_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_password_setup_tokens_hash
  ON users.password_setup_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_password_setup_tokens_user
  ON users.password_setup_tokens (tenant_id, user_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE users.tenant_onboarding_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.tenant_onboarding_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON users.tenant_onboarding_settings;
CREATE POLICY tenant_isolation_policy ON users.tenant_onboarding_settings
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

ALTER TABLE users.password_setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.password_setup_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON users.password_setup_tokens;
CREATE POLICY tenant_isolation_policy ON users.password_setup_tokens
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_svc') THEN
    GRANT USAGE ON SCHEMA users TO identity_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON users.tenant_onboarding_settings TO identity_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON users.password_setup_tokens TO identity_svc;
  END IF;
END $$;
