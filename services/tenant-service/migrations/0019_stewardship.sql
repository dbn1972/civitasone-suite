-- Migration: 0019_stewardship.sql
-- Purpose: CAP-019 — data ownership & stewardship (MISSING before). A register
--          of data domains (which office/role owns which data domain), steward
--          assignments, and a catalogue of data assets with owner + data
--          classification. All tenant-scoped with FORCED RLS.
-- Additive + idempotent.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS tenant.data_domains (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  code          varchar(48) NOT NULL,
  name          varchar(200) NOT NULL,
  description   text,
  owner_office  varchar(160) NOT NULL,
  owner_role    varchar(80) NOT NULL,
  classification varchar(16) NOT NULL DEFAULT 'internal'
                  CHECK (classification IN ('public','internal','confidential','restricted')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_domains_tenant_code
  ON tenant.data_domains (tenant_id, code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_data_domains_tenant ON tenant.data_domains (tenant_id);

CREATE TABLE IF NOT EXISTS tenant.data_stewards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  domain_id       uuid NOT NULL REFERENCES tenant.data_domains(id) ON DELETE CASCADE,
  steward_user_id uuid NOT NULL,
  role            varchar(24) NOT NULL DEFAULT 'steward'
                    CHECK (role IN ('owner','steward','custodian')),
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_stewards_domain_user_role
  ON tenant.data_stewards (domain_id, steward_user_id, role);
CREATE INDEX IF NOT EXISTS idx_data_stewards_tenant ON tenant.data_stewards (tenant_id);

CREATE TABLE IF NOT EXISTS tenant.data_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  domain_id        uuid NOT NULL REFERENCES tenant.data_domains(id) ON DELETE CASCADE,
  name             varchar(200) NOT NULL,
  asset_type       varchar(48) NOT NULL,
  classification   varchar(16) NOT NULL DEFAULT 'internal'
                     CHECK (classification IN ('public','internal','confidential','restricted')),
  system_of_record varchar(120),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_data_assets_tenant ON tenant.data_assets (tenant_id, domain_id);

-- ── RLS ───────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_domains','data_stewards','data_assets'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON tenant.%I USING (tenant_id = tenant.current_tenant_id()) WITH CHECK (tenant_id = tenant.current_tenant_id())', t);
  END LOOP;
END $$;
