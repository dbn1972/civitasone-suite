-- admin-service migration 0056 — `field` (Field Operations) composition module.
--
-- Decision: owner decision #36 (2026-10-26), GAP-FIELD-HOME-04. The gateway
-- module-guard now gates /api/v1/field behind entitlement (ROUTE_TO_MODULE
-- field -> "field"). The composition catalogue had NO `field` module and
-- composition/gateway-map.ts had no mapping, so under composition enforcement
-- EVERY tenant (entitled or not) was denied field. This migration makes the
-- catalogue able to express the entitlement and grandfathers every tenant that
-- reaches field today, so nothing is lost the moment the gate goes live.
--
-- Until now the route was UNMAPPED, i.e. the guard allowed it for everyone
-- (unknown route -> allow). "Reaches field today" therefore means every tenant
-- that is onboarded in either vocabulary, so the grandfather below covers both:
--   * composition.tenant_entitlement  (composition / enforcement path)
--   * config.admin_module_configs     (legacy modules-list path)
--
-- Idempotent (ON CONFLICT / NOT-contains guards); safe to run twice.

-- 1. registry row. Non-core, same shape as visitor/court (0050 section 2b).
--    Global reference catalogue: no tenant_id, no RLS.
INSERT INTO composition.module_registry (id, name, layer, is_core, cluster, hard_deps, soft_deps, screens, sort_order) VALUES
  ('field', 'Field Operations', 3, false, 'services', '{}', ARRAY['inspection'], ARRAY['Field tasks','Visits','Routes'], 450)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, layer = EXCLUDED.layer, is_core = EXCLUDED.is_core, cluster = EXCLUDED.cluster,
  hard_deps = EXCLUDED.hard_deps, soft_deps = EXCLUDED.soft_deps,
  screens = EXCLUDED.screens, sort_order = EXCLUDED.sort_order;

-- 2. bundle + org profiles. Field operations sit with inspection & enforcement
--    (governance bundle). govt_dept and psu already default inspection, so they
--    get field by default; small_office (no inspection) does not.
UPDATE composition.module_bundle
   SET module_ids = array_append(module_ids, 'field')
 WHERE code = 'governance' AND NOT ('field' = ANY(module_ids));

UPDATE composition.org_profile
   SET default_modules = array_append(default_modules, 'field')
 WHERE code IN ('govt_dept', 'psu') AND NOT ('field' = ANY(default_modules));

-- 3. grandfather. Cross-tenant DML on FORCE-RLS tables: drop FORCE for the
--    statements and restore it (sanctioned backfill idiom, house rule 4.3; same
--    as 0050/0051). Every inserted row carries its SOURCE row's own tenant_id.
ALTER TABLE composition.tenant_entitlement NO FORCE ROW LEVEL SECURITY;
ALTER TABLE config.admin_module_configs    NO FORCE ROW LEVEL SECURITY;

INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by)
SELECT DISTINCT e.tenant_id, 'field', 'grandfather', '00000000-0000-0000-0000-000000000000'::uuid
FROM composition.tenant_entitlement e
WHERE EXISTS (SELECT 1 FROM composition.module_registry r WHERE r.id = 'field')
ON CONFLICT (tenant_id, module_id) DO NOTHING;

-- Legacy allow-list tenants (any enabled module row): a modules-list allow-list
-- that omits `field` would now 403 it, so add the row. Never overrides an
-- explicit field row (enabled or not).
INSERT INTO config.admin_module_configs (tenant_id, module_key, enabled, created_by, updated_by)
SELECT DISTINCT mc.tenant_id, 'field', true,
       '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM config.admin_module_configs mc
WHERE mc.enabled = true
ON CONFLICT (tenant_id, module_key) DO NOTHING;

ALTER TABLE config.admin_module_configs    FORCE ROW LEVEL SECURITY;
ALTER TABLE composition.tenant_entitlement FORCE ROW LEVEL SECURITY;
