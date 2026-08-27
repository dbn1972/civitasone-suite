-- citizen-service migration 0020 — Universal Service Designer Phase 0 foundations.
-- Additive only. Extends catalogue.service_definitions; introduces packs registry.
-- Idempotent (IF NOT EXISTS) to match migrate-all.mjs semantics.

CREATE SCHEMA IF NOT EXISTS packs AUTHORIZATION citizen_svc;

-- ── catalogue.service_definitions extensions (FN-01 / §10) ─────────────────
ALTER TABLE catalogue.service_definitions
  ADD COLUMN IF NOT EXISTS service_pattern varchar(32),
  ADD COLUMN IF NOT EXISTS owner_office_id uuid,
  ADD COLUMN IF NOT EXISTS offering_office_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS workflow_definition_id uuid,
  ADD COLUMN IF NOT EXISTS form_id uuid,
  ADD COLUMN IF NOT EXISTS fee_model varchar(8),
  ADD COLUMN IF NOT EXISTS hoa_code varchar(32),
  ADD COLUMN IF NOT EXISTS statutory_references jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE catalogue.service_definitions
  DROP CONSTRAINT IF EXISTS chk_svc_def_pattern;
ALTER TABLE catalogue.service_definitions
  ADD CONSTRAINT chk_svc_def_pattern
  CHECK (service_pattern IS NULL OR service_pattern IN ('certificate','booking','collection','grievance'));

ALTER TABLE catalogue.service_definitions
  DROP CONSTRAINT IF EXISTS chk_svc_def_fee_model;
ALTER TABLE catalogue.service_definitions
  ADD CONSTRAINT chk_svc_def_fee_model
  CHECK (fee_model IS NULL OR fee_model IN ('flat','slab','engine'));

-- ── packs.domain_packs — sector template library (FN-09 / §8) ────────────────
CREATE TABLE IF NOT EXISTS packs.domain_packs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  domain_pack_key  varchar(64) NOT NULL,
  sector           varchar(32) NOT NULL,
  jurisdiction     varchar(16),
  version          integer NOT NULL DEFAULT 1,
  name             text NOT NULL,
  description      text,
  manifest         jsonb NOT NULL DEFAULT '{}'::jsonb,
  pack_keys        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status           varchar(16) NOT NULL DEFAULT 'published'
                     CHECK (status IN ('draft','published','archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  row_version      integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_pack_key_version
  ON packs.domain_packs (tenant_id, domain_pack_key, version);

-- ── packs.service_packs — importable service bundles ───────────────────────
CREATE TABLE IF NOT EXISTS packs.service_packs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  source_tenant_id        uuid,
  pack_key                varchar(64) NOT NULL,
  domain_pack_key         varchar(64),
  name                    text NOT NULL,
  service_pattern         varchar(32),
  service_definition_id   uuid,
  form_id                 uuid,
  eligibility_rule_set_id uuid,
  fee_model               varchar(8),
  fee_ref_id              uuid,
  workflow_definition_id  uuid,
  hoa_code                varchar(32),
  engine_bindings         jsonb NOT NULL DEFAULT '[]'::jsonb,
  statutory_references    jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                  varchar(16) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','published','archived')),
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  updated_by              uuid NOT NULL,
  row_version             integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_pack_key_version
  ON packs.service_packs (tenant_id, pack_key, version);

-- ── municipal-in-v1 seed (Phase 0 reference Domain Pack) ───────────────────
-- Seeded here, BEFORE RLS is enabled below (moved ahead of the "RLS (tenant
-- isolation)" block, which originally preceded this section). packs.tenant_id
-- is a genuine NOT NULL column (matches the Drizzle model in
-- services/citizen-service/src/modules/packs/schema.ts — this is not
-- platform-global reference data like tenant-service's nullable code_lists),
-- and this migration's own session never sets the app.tenant_id GUC, so once
-- FORCE ROW LEVEL SECURITY + the tenant_isolation policy are active below,
-- portal.current_tenant_id() resolves to NULL and WITH CHECK rejects the
-- literal-tenant seed row with "new row violates row-level security policy".
-- Inserting first, while the table is still an ordinary unrestricted table
-- (RLS has no effect until ENABLE ROW LEVEL SECURITY runs), mirrors how every
-- other seed-then-RLS sequence in this codebase avoids the same trap (e.g.
-- workflow-service seeds workflow.definitions in 0003, RLS is only added in
-- 0013 — a later file, not a bypass).
INSERT INTO packs.domain_packs (
  id, tenant_id, domain_pack_key, sector, jurisdiction, version, name, description,
  manifest, pack_keys, status, created_by, updated_by
) VALUES (
  'aaaaaaaa-0001-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'municipal-in-v1',
  'municipal',
  'IN',
  1,
  'Municipal / ULB Services (India)',
  'Reference Domain Pack: Trade License, Water Connection, PGR, Fire NOC, Property Tax, Birth & Death.',
  '{"jurisdiction":"IN","sector":"municipal","statutoryProfile":"ulb_general","pilotOrder":["trade-license","pgr","water-connection","fire-noc","property-tax","birth-death"]}'::jsonb,
  '["pack:trade-license","pack:water-connection","pack:pgr","pack:fire-noc","pack:property-tax","pack:birth-death"]'::jsonb,
  'published',
  '00000000-0000-0000-0000-000000000099',
  '00000000-0000-0000-0000-000000000099'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO packs.service_packs (
  id, tenant_id, pack_key, domain_pack_key, name, service_pattern, fee_model, hoa_code,
  manifest, status, version, created_by, updated_by
) VALUES
  ('bbbbbbbb-0001-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'pack:trade-license', 'municipal-in-v1', 'Trade License', 'certificate', 'flat', '4201', '{"businessService":"TL","pilot":true}'::jsonb, 'published', 1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('bbbbbbbb-0002-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'pack:water-connection', 'municipal-in-v1', 'Water & Sewerage Connection', 'certificate', 'flat', '4202', '{"businessService":"WS","pilot":true}'::jsonb, 'published', 1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('bbbbbbbb-0003-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'pack:pgr', 'municipal-in-v1', 'Public Grievance (PGR)', 'grievance', NULL, NULL, '{"businessService":"PGR","pilot":true}'::jsonb, 'published', 1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('bbbbbbbb-0004-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'pack:fire-noc', 'municipal-in-v1', 'Fire NOC', 'certificate', 'slab', '4204', '{"businessService":"FN","pilot":true}'::jsonb, 'published', 1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('bbbbbbbb-0005-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'pack:property-tax', 'municipal-in-v1', 'Property Tax Self-Assessment', 'collection', 'engine', '4205', '{"businessService":"PT","engineKey":"revenue.assessment","pilot":true}'::jsonb, 'published', 1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099'),
  ('bbbbbbbb-0006-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'pack:birth-death', 'municipal-in-v1', 'Birth & Death Registration', 'certificate', 'flat', '4206', '{"businessService":"BD","statutory":true,"pilot":true}'::jsonb, 'published', 1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (id) DO NOTHING;

-- ── RLS (tenant isolation) ─────────────────────────────────────────────────
ALTER TABLE packs.domain_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE packs.domain_packs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON packs.domain_packs;
CREATE POLICY tenant_isolation ON packs.domain_packs
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

ALTER TABLE packs.service_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE packs.service_packs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON packs.service_packs;
CREATE POLICY tenant_isolation ON packs.service_packs
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- Reassign ownership to citizen_svc (mirrors 0015/0016)
ALTER SCHEMA packs OWNER TO citizen_svc;
ALTER TABLE packs.domain_packs OWNER TO citizen_svc;
ALTER TABLE packs.service_packs OWNER TO citizen_svc;
