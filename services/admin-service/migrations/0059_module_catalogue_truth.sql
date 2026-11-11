-- admin-service migration 0059 — module catalogue truth + single source (M1, M4).
--
-- Source of truth in code: packages/schemas/src/module-catalogue.ts. A real-DB test
-- (tests/module-catalogue-parity.test.ts) fails if composition.module_registry drifts from it.
--
-- 1. Catalogue completeness: the 17 municipal (Sec5) services are routed by the gateway but had no registry
--    row, so no tenant could be entitled to them and 'enforce' would 403 every tenant on them.
-- 2. Dependency corrections, derived from the service code (see the PR body for evidence):
--      payroll     hard employee,config,finance -> employee,config            (finance becomes soft)
--      inventory   hard finance                 -> finance,procurement         (SRN gated by the GRN; stock entries from procurement.grn.accepted)
--      contract    hard workflow                -> workflow,procurement        (vendor master + PO lookup live in procurement)
--      legal       hard workflow                -> workflow,employee           (department list + officer directory come from HRMS)
--      + soft edges the code already has (events/calls used when present): finance, citizen, employee, procurement,
--        project, analytics, inspection, helpdesk, crm, meeting.
-- 3. NO CHANGE FOR EXISTING TENANTS: before the dependency edit, every tenant's CURRENT hard-dependency closure
--    (old registry) is written down as explicit 'grandfather' entitlements, so e.g. a tenant that got Finance only
--    because Payroll pulled it in keeps Finance. Guarded so it runs exactly once (while payroll still hard-requires finance).
-- 4. M4 single source: the older switch list (config.admin_module_configs enabled gateway keys) is carried into
--    the catalogue for tenants that have no 'user' selection (legacy-only or grandfather-only tenants), using the
--    inverse of the catalogue gatewayKeys. A tenant that composed its own modules is untouched (its legacy rows are
--    stale and inert). Never removes anything. Idempotent: ON CONFLICT DO NOTHING; safe to run twice.
--
-- Cross-tenant DML on FORCE-RLS tables uses the sanctioned NO FORCE ... FORCE idiom (as 0050/0056); every inserted
-- row carries its SOURCE row's own tenant_id.

-- 1. municipal modules ------------------------------------------------------
INSERT INTO composition.module_registry (id, name, layer, is_core, cluster, hard_deps, soft_deps, screens, sort_order) VALUES
  ('shop', 'Shops & Establishments', 3, false, 'municipal', '{}', '{}', ARRAY['Shops & Establishments'], 500),
  ('trade', 'Trade Licences', 3, false, 'municipal', '{}', '{}', ARRAY['Trade Licences'], 501),
  ('building', 'Building Permissions', 3, false, 'municipal', '{}', '{}', ARRAY['Building Permissions'], 502),
  ('fire', 'Fire NOC', 3, false, 'municipal', '{}', '{}', ARRAY['Fire NOC'], 503),
  ('advertisement', 'Advertisement Permits', 3, false, 'municipal', '{}', '{}', ARRAY['Advertisement Permits'], 504),
  ('vendor', 'Street Vendors', 3, false, 'municipal', '{}', '{}', ARRAY['Street Vendors'], 505),
  ('roadcut', 'Road-cut Permissions', 3, false, 'municipal', '{}', '{}', ARRAY['Road-cut Permissions'], 506),
  ('event', 'Event Permissions', 3, false, 'municipal', '{}', '{}', ARRAY['Event Permissions'], 507),
  ('refund', 'Refunds', 3, false, 'municipal', '{}', '{}', ARRAY['Refunds'], 508),
  ('sewerage', 'Sewerage', 3, false, 'municipal', '{}', '{}', ARRAY['Sewerage'], 509),
  ('swm', 'Solid Waste Management', 3, false, 'municipal', '{}', '{}', ARRAY['Solid Waste Management'], 510),
  ('drainage', 'Drainage', 3, false, 'municipal', '{}', '{}', ARRAY['Drainage'], 511),
  ('parks', 'Parks & Gardens', 3, false, 'municipal', '{}', '{}', ARRAY['Parks & Gardens'], 512),
  ('animal', 'Animal Licensing', 3, false, 'municipal', '{}', '{}', ARRAY['Animal Licensing'], 513),
  ('crematorium', 'Crematoria', 3, false, 'municipal', '{}', '{}', ARRAY['Crematoria'], 514),
  ('parking', 'Parking', 3, false, 'municipal', '{}', '{}', ARRAY['Parking'], 515),
  ('market', 'Markets', 3, false, 'municipal', '{}', '{}', ARRAY['Markets'], 516)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, layer = EXCLUDED.layer, is_core = EXCLUDED.is_core, cluster = EXCLUDED.cluster,
  hard_deps = EXCLUDED.hard_deps, soft_deps = EXCLUDED.soft_deps, screens = EXCLUDED.screens, sort_order = EXCLUDED.sort_order;

-- 3. materialise the OLD closure before the dependency edit ---------------------
ALTER TABLE composition.tenant_entitlement NO FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM composition.module_registry WHERE id = 'payroll' AND 'finance' = ANY(hard_deps)) THEN
    INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by)
    WITH RECURSIVE closure(tenant_id, module_id) AS (
      SELECT e.tenant_id, e.module_id FROM composition.tenant_entitlement e WHERE e.source IN ('user','grandfather')
      UNION
      SELECT c.tenant_id, d
      FROM closure c
      JOIN composition.module_registry r ON r.id = c.module_id
      CROSS JOIN LATERAL unnest(r.hard_deps) AS d
    )
    SELECT DISTINCT c.tenant_id, c.module_id, 'grandfather', '00000000-0000-0000-0000-000000000000'::uuid
    FROM closure c
    JOIN composition.module_registry r ON r.id = c.module_id
    WHERE NOT r.is_core
    ON CONFLICT (tenant_id, module_id) DO UPDATE SET source = 'grandfather', updated_at = now()
      WHERE composition.tenant_entitlement.source = 'dep';
  END IF;
END $$;
ALTER TABLE composition.tenant_entitlement FORCE ROW LEVEL SECURITY;

-- 2. dependency corrections --------------------------------------------------
UPDATE composition.module_registry r SET hard_deps = v.hard_deps, soft_deps = v.soft_deps
FROM (VALUES
  ('payroll', ARRAY['employee','config']::text[], ARRAY['attendance','leave','loans','finance','benefits']::text[]),
  ('inventory', ARRAY['finance','procurement']::text[], '{}'::text[]),
  ('contract', ARRAY['workflow','procurement']::text[], '{}'::text[]),
  ('legal', ARRAY['workflow','employee']::text[], ARRAY['meeting']::text[]),
  ('finance', ARRAY['config']::text[], ARRAY['payroll','procurement','grant','billing','citizen','meeting','revenue']::text[]),
  ('citizen', ARRAY['workflow']::text[], ARRAY['finance','employee']::text[]),
  ('employee', ARRAY['org','config']::text[], ARRAY['payroll','meeting','citizen']::text[]),
  ('procurement', ARRAY['finance','budget','workflow']::text[], ARRAY['contract','legal','inventory','meeting','employee']::text[]),
  ('project', ARRAY['config']::text[], ARRAY['grant','finance','meeting']::text[]),
  ('analytics', ARRAY['config']::text[], ARRAY['finance','procurement','grant','employee','meeting','court','visitor']::text[]),
  ('inspection', ARRAY['employee','workflow']::text[], ARRAY['leave']::text[]),
  ('helpdesk', '{}'::text[], ARRAY['citizen','crm','asset','knowledge','telephony']::text[]),
  ('crm', '{}'::text[], ARRAY['telephony']::text[]),
  ('meeting', '{}'::text[], ARRAY['employee']::text[])
) AS v(id, hard_deps, soft_deps) WHERE r.id = v.id;

-- 4. carry the older switch list into the catalogue ----------------------------
ALTER TABLE composition.tenant_entitlement NO FORCE ROW LEVEL SECURITY;
ALTER TABLE config.admin_module_configs    NO FORCE ROW LEVEL SECURITY;

WITH legacy(gateway_key, module_id) AS (
  VALUES
    ('establishment','employee'), ('reports','ess'), ('reports','analytics'), ('smarttransfer','smarttransfer'), ('finance','finance'), ('finance','budget'), ('finance','treasury'), ('finance','revenue'), ('payroll','payroll'), ('payroll','loans'), ('payroll','benefits'), ('payroll','separation'), ('procurement','procurement'), ('contracts','contract'), ('inventory','inventory'), ('stock','inventory'), ('assets','asset'), ('projects','works'), ('projects','project'), ('grants','grant'), ('citizen','citizen'), ('crm','crm'), ('helpdesk','helpdesk'), ('knowledge','knowledge'), ('legal','legal'), ('inspection','inspection'), ('analytics','analytics'), ('telephony','telephony'), ('meeting','meeting'), ('court','court'), ('visitor','visitor'), ('billing','billing'), ('field','field'), ('shop','shop'), ('trade','trade'), ('building','building'), ('fire','fire'), ('advertisement','advertisement'), ('vendor','vendor'), ('roadcut','roadcut'), ('event','event'), ('refund','refund'), ('sewerage','sewerage'), ('swm','swm'), ('drainage','drainage'), ('parks','parks'), ('animal','animal'), ('crematorium','crematorium'), ('parking','parking'), ('market','market'), ('hrms','employee'), ('hrms','attendance'), ('hrms','leave'), ('hrms','recruitment'), ('hrms','appraisal'), ('hrms','career'), ('hrms','ess')
)
INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by)
SELECT DISTINCT mc.tenant_id, l.module_id, 'grandfather', '00000000-0000-0000-0000-000000000000'::uuid
FROM config.admin_module_configs mc
JOIN legacy l ON l.gateway_key = mc.module_key
WHERE mc.enabled = true
  AND EXISTS (SELECT 1 FROM composition.module_registry r WHERE r.id = l.module_id)
  AND NOT EXISTS (SELECT 1 FROM composition.tenant_entitlement u WHERE u.tenant_id = mc.tenant_id AND u.source = 'user')
ON CONFLICT (tenant_id, module_id) DO NOTHING;

ALTER TABLE config.admin_module_configs    FORCE ROW LEVEL SECURITY;
ALTER TABLE composition.tenant_entitlement FORCE ROW LEVEL SECURITY;
