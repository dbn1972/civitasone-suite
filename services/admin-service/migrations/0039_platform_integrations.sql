-- Migration: 0039_platform_integrations.sql
-- Purpose: platform integration catalogue + per-tenant integration config for
--   eSign (Aadhaar ESPs), DSC (USB-token bridge / remote HSM), corporate bank
--   API / H2H and PFMS. Decision 2026-10-03: the screens, tenant config and the
--   super-admin catalogue are built now; the real provider integrations come in
--   UAT (adapters are mock in sandbox, NotImplemented in production).
--
-- Two layers:
--   platform_integrations.providers                    PLATFORM catalogue (no tenant_id)
--   platform_integrations.tenant_integrations          tenant config   (FORCE RLS)
--   platform_integrations.production_switch_requests   maker-checker   (FORCE RLS)
--   platform_integrations.tenant_integration_settings  per-tenant policy (FORCE RLS)
--
-- RLS JUSTIFICATION for `providers` (global reference data, no tenant_id):
--   * SELECT is open (USING true): every tenant must read the catalogue to pick a
--     provider; it holds no tenant data and no secrets.
--   * INSERT/UPDATE/DELETE are allowed only when the transaction sets the GUC
--     app.platform_catalogue_write = 'true'. That GUC is set ONLY by server code
--     (the catalogue consumer, after the route has enforced super_admin /
--     platform_admin) and never from client input -- the same trust model as
--     migration 0011's app.platform_bypass, extended to writes for this one
--     reference table. A tenant-scoped request can therefore never mutate it.
--   * tenant_integrations gets a SELECT-only platform_bypass_read_policy (as in
--     0011) so the super-admin catalogue screen can show usage counts; writes
--     stay strictly tenant-matched.
--
-- Secrets: tenant_integrations.secrets holds ONLY sealed values
--   ("enc:v2:<keyid>:<b64>", AES-256-GCM keyring envelope); plaintext never
--   touches the database, the queue or any API response.
--
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP SCHEMA platform_integrations CASCADE;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS platform_integrations;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

-- ── platform catalogue ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_integrations.providers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                varchar(64)  NOT NULL,
  category           varchar(16)  NOT NULL,
  name               varchar(200) NOT NULL,
  vendor             varchar(200) NOT NULL DEFAULT '',
  description        text         NOT NULL DEFAULT '',
  capabilities       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  config_schema      jsonb        NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  endpoints          jsonb        NOT NULL DEFAULT '{"sandbox":null,"production":null}'::jsonb,
  status             varchar(16)  NOT NULL DEFAULT 'available',
  availability_mode  varchar(16)  NOT NULL DEFAULT 'all',
  allowed_tenant_ids uuid[]       NOT NULL DEFAULT '{}',
  allowed_editions   text[]       NOT NULL DEFAULT '{}',
  sort_order         integer      NOT NULL DEFAULT 100,
  version            integer      NOT NULL DEFAULT 1,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  updated_by         uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_providers_key ON platform_integrations.providers (key);
CREATE INDEX IF NOT EXISTS idx_pi_providers_category ON platform_integrations.providers (category, sort_order);

DO $$ BEGIN
  ALTER TABLE platform_integrations.providers
    ADD CONSTRAINT pi_providers_category_chk CHECK (category IN ('esign','dsc','bank_api','pfms'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE platform_integrations.providers
    ADD CONSTRAINT pi_providers_status_chk CHECK (status IN ('available','beta','disabled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE platform_integrations.providers
    ADD CONSTRAINT pi_providers_availability_chk CHECK (availability_mode IN ('all','restricted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── tenant integration config ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_integrations.tenant_integrations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  provider_key           varchar(64) NOT NULL REFERENCES platform_integrations.providers (key) ON DELETE RESTRICT,
  category               varchar(16) NOT NULL,
  environment            varchar(16) NOT NULL DEFAULT 'sandbox',
  enabled                boolean     NOT NULL DEFAULT true,
  config                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  secrets                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_test_status       varchar(16),
  last_test_code         varchar(40),
  last_test_message      text,
  last_test_at           timestamptz,
  last_test_environment  varchar(16),
  version                integer     NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid        NOT NULL,
  updated_by             uuid        NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_tenant_integrations_tenant_provider
  ON platform_integrations.tenant_integrations (tenant_id, provider_key);
CREATE INDEX IF NOT EXISTS idx_pi_tenant_integrations_tenant_category
  ON platform_integrations.tenant_integrations (tenant_id, category);

DO $$ BEGIN
  ALTER TABLE platform_integrations.tenant_integrations
    ADD CONSTRAINT pi_tenant_integrations_env_chk CHECK (environment IN ('sandbox','production'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE platform_integrations.tenant_integrations
    ADD CONSTRAINT pi_tenant_integrations_test_chk CHECK (last_test_status IS NULL OR last_test_status IN ('success','failure'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── production-switch maker-checker ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_integrations.production_switch_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  integration_id  uuid        NOT NULL REFERENCES platform_integrations.tenant_integrations (id) ON DELETE CASCADE,
  provider_key    varchar(64) NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'pending',
  reason          text        NOT NULL,
  base_version    integer     NOT NULL,
  requested_by    uuid        NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  direct          boolean     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_pi_switch_requests_tenant_status
  ON platform_integrations.production_switch_requests (tenant_id, status);
-- At most one pending request per integration (also makes a retried request idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_switch_requests_one_pending
  ON platform_integrations.production_switch_requests (integration_id) WHERE status = 'pending';

DO $$ BEGIN
  ALTER TABLE platform_integrations.production_switch_requests
    ADD CONSTRAINT pi_switch_requests_status_chk CHECK (status IN ('pending','approved','rejected','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Segregation of duties, last line of defence in the DB: an approved/rejected
-- decision made by someone else than the requester, unless it was a direct
-- (approval-disabled) switch or a cancellation by the requester.
DO $$ BEGIN
  ALTER TABLE platform_integrations.production_switch_requests
    ADD CONSTRAINT pi_switch_requests_maker_checker_chk CHECK (
      status = 'pending'
      OR direct
      OR status = 'cancelled'
      OR decided_by IS DISTINCT FROM requested_by
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── per-tenant policy ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_integrations.tenant_integration_settings (
  tenant_id                   uuid PRIMARY KEY,
  require_production_approval boolean     NOT NULL DEFAULT true,
  version                     integer     NOT NULL DEFAULT 1,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid        NOT NULL
);

-- ── RLS: tenant tables (full isolation, mirrors 0021) ────────────────────────
ALTER TABLE platform_integrations.tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_integrations.tenant_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON platform_integrations.tenant_integrations;
CREATE POLICY tenant_isolation_policy ON platform_integrations.tenant_integrations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS platform_bypass_read_policy ON platform_integrations.tenant_integrations;
CREATE POLICY platform_bypass_read_policy ON platform_integrations.tenant_integrations
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

ALTER TABLE platform_integrations.production_switch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_integrations.production_switch_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON platform_integrations.production_switch_requests;
CREATE POLICY tenant_isolation_policy ON platform_integrations.production_switch_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE platform_integrations.tenant_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_integrations.tenant_integration_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON platform_integrations.tenant_integration_settings;
CREATE POLICY tenant_isolation_policy ON platform_integrations.tenant_integration_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── RLS: platform catalogue (global; GUC-gated writes) ───────────────────────
ALTER TABLE platform_integrations.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_integrations.providers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS providers_read_policy ON platform_integrations.providers;
CREATE POLICY providers_read_policy ON platform_integrations.providers
  FOR SELECT USING (true);
DROP POLICY IF EXISTS providers_insert_policy ON platform_integrations.providers;
CREATE POLICY providers_insert_policy ON platform_integrations.providers
  FOR INSERT WITH CHECK (current_setting('app.platform_catalogue_write', true) = 'true');
DROP POLICY IF EXISTS providers_update_policy ON platform_integrations.providers;
CREATE POLICY providers_update_policy ON platform_integrations.providers
  FOR UPDATE
  USING (current_setting('app.platform_catalogue_write', true) = 'true')
  WITH CHECK (current_setting('app.platform_catalogue_write', true) = 'true');
DROP POLICY IF EXISTS providers_delete_policy ON platform_integrations.providers;
CREATE POLICY providers_delete_policy ON platform_integrations.providers
  FOR DELETE USING (current_setting('app.platform_catalogue_write', true) = 'true');

-- ── grants (runtime role) ────────────────────────────────────────────────────
DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA platform_integrations TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform_integrations TO admin_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA platform_integrations GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_svc;
  END IF;
END $g$;
