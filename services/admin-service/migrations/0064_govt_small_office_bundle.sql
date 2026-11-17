-- 0064_govt_small_office_bundle.sql
-- Tenant-profile slice B2: the missing `govt_small_office` composition rows. The catalogue (@civitasone/tenant-profile
-- PROFILES) names bundleCode `govt_small_office`, but 0025/0026/0062 only seeded govt_dept, psu, small_office, section8,
-- so a govt_small_office tenant had nothing to compose. Adds:
--   1. composition.org_profile `govt_small_office` (govt family): rule_packs / terminology / statutory / reservation are
--      COPIED from the live govt_dept row (a small govt office is a variant of the department, not a commercial profile),
--      default_modules is the explicit 17-module set from docs/design/TENANT-PROFILE-SWITCH.md section 5 (Bundle table).
--   2. composition.module_bundle `govt_small_office` whose module_ids are DERIVED from that profile row (same drift-proof
--      pattern as 0062), so bundle == profile default_modules always.
-- The 5 core modules are implicit (always on), 17 are listed, 22 effective. Excluded by design: recruitment, career,
-- workforce_core, smarttransfer, revenue, contract, works, project, grant, citizen, crm, helpdesk, knowledge, inspection,
-- telephony, meeting, court, visitor, billing, field.
-- Purely additive + idempotent (ON CONFLICT DO NOTHING; an owner edit of the rows is never clobbered). govt_dept and every
-- existing tenant entitlement are untouched. Composition only happens when TENANT_PROFILES_ENABLED=true AND the catalogue
-- profile has composeOnOnboard=true, and then in enforcement mode `shadow` (hides nothing).
-- Apply as the owning service role (admin_svc).
-- ROLLBACK: DELETE FROM composition.module_bundle WHERE code = 'govt_small_office';
--           DELETE FROM composition.org_profile WHERE code = 'govt_small_office';
SET lock_timeout = '5s';

INSERT INTO composition.org_profile (code, label, subtitle, rule_packs, terminology, statutory, reservation, default_modules, sort_order)
SELECT 'govt_small_office', 'Small government office', 'Block / tehsil / sub-registrar / district section office',
       g.rule_packs, g.terminology, g.statutory, g.reservation,
       ARRAY['employee','attendance','leave','appraisal','ess',
             'payroll','loans','benefits','separation',
             'finance','budget','treasury',
             'procurement','inventory','asset',
             'legal','analytics'],
       15
  FROM composition.org_profile g
 WHERE g.code = 'govt_dept'
ON CONFLICT (code) DO NOTHING;

-- Must stay AFTER the org_profile insert above.
INSERT INTO composition.module_bundle (code, label, subtitle, module_ids, sort_order)
SELECT p.code, 'Small government office', 'HR, payroll, treasury-bound finance, GFR purchase, RTI, MIS', p.default_modules, 123
  FROM composition.org_profile p
 WHERE p.code = 'govt_small_office'
ON CONFLICT (code) DO NOTHING;
