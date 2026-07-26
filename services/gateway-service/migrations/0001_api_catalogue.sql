-- Migration: 0001_api_catalogue.sql
-- Purpose: CAP-052 — persistent API catalogue / versioning / lifecycle for the
--          gateway-service. Registers every platform API surface (name, module,
--          version, path, method, owner, lifecycle status) plus an append-only
--          changelog of lifecycle transitions (register/deprecate/retire/...).
-- Rollback: DROP TABLE IF EXISTS catalogue.api_changelog;
--           DROP TABLE IF EXISTS catalogue.api_entry;
-- Service:  gateway-service (catalogue module) — DB civitas_gateway, role gateway_svc.
-- Notes:    Additive + idempotent. Fail-closed tenant isolation via FORCE RLS.

SET lock_timeout = '5s';

-- Tenant resolver mirrors the per-service pattern (budget.current_tenant_id()).
CREATE OR REPLACE FUNCTION catalogue.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ── api_entry: one row per (versioned) API surface ──────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.api_entry (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  name             TEXT NOT NULL,
  module           TEXT NOT NULL,
  version          TEXT NOT NULL DEFAULT 'v1',
  path             TEXT NOT NULL,
  method           VARCHAR(10) NOT NULL DEFAULT 'GET'
                     CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','ANY')),
  upstream         TEXT,
  owner            TEXT,
  status           VARCHAR(16) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','deprecated','retired')),
  description      TEXT,
  deprecation_date DATE,
  sunset_date      DATE,
  source           VARCHAR(16) NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','registry','seed')),
  row_version      INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One catalogue row per API name+version+method+path per tenant. Idempotent
  -- registration / seed relies on this for ON CONFLICT upserts.
  CONSTRAINT uq_api_entry_tenant_key UNIQUE (tenant_id, name, version, method, path)
);

CREATE INDEX IF NOT EXISTS idx_api_entry_tenant_status
  ON catalogue.api_entry (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_api_entry_tenant_module
  ON catalogue.api_entry (tenant_id, module);

ALTER TABLE catalogue.api_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.api_entry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON catalogue.api_entry;
CREATE POLICY tenant_isolation_policy ON catalogue.api_entry
  USING (tenant_id = catalogue.current_tenant_id())
  WITH CHECK (tenant_id = catalogue.current_tenant_id());

-- ── api_changelog: append-only lifecycle history ────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue.api_changelog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  api_id       UUID NOT NULL,
  change_type  VARCHAR(24) NOT NULL
                 CHECK (change_type IN ('registered','updated','activated','deprecated','retired','reinstated')),
  from_status  VARCHAR(16),
  to_status    VARCHAR(16),
  note         TEXT,
  actor_id     UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_changelog_tenant_api
  ON catalogue.api_changelog (tenant_id, api_id, created_at);

ALTER TABLE catalogue.api_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.api_changelog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON catalogue.api_changelog;
CREATE POLICY tenant_isolation_policy ON catalogue.api_changelog
  USING (tenant_id = catalogue.current_tenant_id())
  WITH CHECK (tenant_id = catalogue.current_tenant_id());
