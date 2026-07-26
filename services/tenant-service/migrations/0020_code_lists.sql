-- Migration: 0020_code_lists.sql
-- Purpose: CAP-017 — central controlled-vocabulary / reference-code service.
--          code_lists + code_values, each either tenant-scoped (tenant_id set)
--          or platform-global (tenant_id NULL, shared by all tenants). Values
--          are effective-dated (CAP-018) so a code can be superseded without
--          losing history. RLS lets a tenant read its own rows + globals, but
--          only write its own; globals are seeded here (platform context).
-- Additive + idempotent.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS tenant.code_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,                       -- NULL = platform-global
  code        varchar(64) NOT NULL,
  name        varchar(200) NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);
-- One list per code within a tenant, and one per code among globals.
CREATE UNIQUE INDEX IF NOT EXISTS uq_code_lists_tenant_code ON tenant.code_lists (tenant_id, code) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_code_lists_global_code ON tenant.code_lists (code) WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS tenant.code_values (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid,                    -- NULL = platform-global (matches its list)
  list_id        uuid NOT NULL REFERENCES tenant.code_lists(id) ON DELETE CASCADE,
  code           varchar(64) NOT NULL,
  label          varchar(200) NOT NULL,
  sort_order     int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  metadata       jsonb NOT NULL DEFAULT '{}',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid
);
CREATE INDEX IF NOT EXISTS idx_code_values_list ON tenant.code_values (list_id, effective_to);
CREATE UNIQUE INDEX IF NOT EXISTS uq_code_values_list_code_active
  ON tenant.code_values (list_id, code) WHERE effective_to IS NULL;

-- ── RLS: read own + global; write own only (globals seeded in platform ctx) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['code_lists','code_values'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.%I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON tenant.%I
      USING (tenant_id = tenant.current_tenant_id() OR tenant_id IS NULL)
      WITH CHECK (tenant_id = tenant.current_tenant_id()
                  OR (tenant_id IS NULL AND tenant.current_tenant_id() IS NULL))$p$, t);
  END LOOP;
END $$;

-- ── Seed a few platform-global controlled vocabularies (idempotent) ──
INSERT INTO tenant.code_lists (id, tenant_id, code, name, description, is_system)
VALUES
  ('00000000-0000-4000-8000-0000000c0001', NULL, 'yes_no', 'Yes / No', 'Boolean-style controlled vocabulary', true),
  ('00000000-0000-4000-8000-0000000c0002', NULL, 'salutation', 'Salutation', 'Person salutations', true),
  ('00000000-0000-4000-8000-0000000c0003', NULL, 'gender', 'Gender', 'Gender codes', true)
ON CONFLICT DO NOTHING;

INSERT INTO tenant.code_values (tenant_id, list_id, code, label, sort_order) VALUES
  (NULL, '00000000-0000-4000-8000-0000000c0001', 'Y', 'Yes', 1),
  (NULL, '00000000-0000-4000-8000-0000000c0001', 'N', 'No', 2),
  (NULL, '00000000-0000-4000-8000-0000000c0002', 'MR', 'Mr', 1),
  (NULL, '00000000-0000-4000-8000-0000000c0002', 'MS', 'Ms', 2),
  (NULL, '00000000-0000-4000-8000-0000000c0002', 'DR', 'Dr', 3),
  (NULL, '00000000-0000-4000-8000-0000000c0003', 'M', 'Male', 1),
  (NULL, '00000000-0000-4000-8000-0000000c0003', 'F', 'Female', 2),
  (NULL, '00000000-0000-4000-8000-0000000c0003', 'O', 'Other', 3)
ON CONFLICT DO NOTHING;
