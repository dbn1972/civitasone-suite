-- Migration: 0021_positions.sql
-- Purpose: CAP-014 (position/designation hierarchy — sanctioned posts) and
--          CAP-015 (role-to-position mapping). A real sanctioned-position model
--          attached to org_units, effective-dated, with a mapping of platform
--          roles onto positions. Tenant-scoped, FORCED RLS.
-- Additive + idempotent.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS tenant.positions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  org_unit_id         uuid REFERENCES tenant.org_units(id) ON DELETE SET NULL,
  code                varchar(48) NOT NULL,
  title               varchar(200) NOT NULL,
  grade               varchar(48),
  sanctioned_strength int NOT NULL DEFAULT 1 CHECK (sanctioned_strength >= 0),
  filled_strength     int NOT NULL DEFAULT 0 CHECK (filled_strength >= 0),
  status              varchar(16) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','frozen','abolished')),
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_to        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_positions_tenant_code_active
  ON tenant.positions (tenant_id, code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_positions_tenant ON tenant.positions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_positions_org_unit ON tenant.positions (tenant_id, org_unit_id);

CREATE TABLE IF NOT EXISTS tenant.position_role_map (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  position_id uuid NOT NULL REFERENCES tenant.positions(id) ON DELETE CASCADE,
  role_key    varchar(64) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_position_role_map ON tenant.position_role_map (position_id, role_key);
CREATE INDEX IF NOT EXISTS idx_position_role_map_tenant ON tenant.position_role_map (tenant_id);

-- ── RLS ───────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['positions','position_role_map'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON tenant.%I USING (tenant_id = tenant.current_tenant_id()) WITH CHECK (tenant_id = tenant.current_tenant_id())', t);
  END LOOP;
END $$;
