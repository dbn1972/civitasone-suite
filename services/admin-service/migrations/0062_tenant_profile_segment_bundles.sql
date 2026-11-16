-- 0062_tenant_profile_segment_bundles.sql
-- Tenant-profile slice S5 (docs/design/TENANT-PROFILE-SWITCH.md section 2.4 / S5): non-govt segment profiles + bundles.
--   1. RELABEL the mislabelled org_profile `small_office` ("Section-8 Company") to "Small business / MSME".
--      Only label + subtitle change; rule_packs / default_modules / statutory are NOT touched (tests depend on them).
--   2. ADD an org_profile row `section8` (Section 8 company; the nonprofit segment).
--   3. ADD module_bundle rows `section8`, `small_office`, `psu` (one-click cluster == the profile default set).
-- Purely additive + idempotent. Govt rows (govt_dept) and every existing tenant entitlement are untouched.
-- NOTE: the strings in rule_packs (e.g. "fcra_12a_80g", "psu_manual") are DISPLAY LABELS, not behaviour; nothing
-- reads them to decide behaviour (design 2.4: behaviour comes from stored settings). They are left as-is on purpose.
-- SCOPE-TUNABLE: the module sets below are the 0026 defaults (psu, small_office) and the same small footprint for
-- section8; the owner may adjust them per pilot with a later UPDATE. Apply as the owning service role (admin_svc).
-- ROLLBACK: DELETE FROM composition.module_bundle WHERE code IN ('section8','small_office','psu');
--           DELETE FROM composition.org_profile WHERE code = 'section8';
--           UPDATE composition.org_profile SET label = 'Section-8 Company', subtitle = 'Non-profit / private' WHERE code = 'small_office';
SET lock_timeout = '5s';

UPDATE composition.org_profile
   SET label = 'Small business / MSME', subtitle = 'Micro, small and medium enterprise'
 WHERE code = 'small_office' AND label = 'Section-8 Company';

INSERT INTO composition.org_profile (code, label, subtitle, rule_packs, terminology, statutory, reservation, default_modules, sort_order) VALUES
  ('section8', 'Section 8 company', 'Non-profit company (Companies Act s.8)',
    '{"pay":"ctc","leave":"shops_estab","appraisal":"okr","separation":"epf_gratuity","accounting_basis":"commercial_accrual_fcra","procurement_rulebook":"private","revenue_type":"grants_donations","audit_profile":"fcra_12a_80g"}'::jsonb,
    '{"post":"Designation","unit":"Department","strength":"Approved headcount","pay":"CTC (Basic+HRA+Special+PF)"}'::jsonb,
    '{"epf":true,"esi":true,"gratuity":true,"pt":true,"tds":true}'::jsonb,
    false,
    ARRAY['employee','attendance','leave','appraisal','ess','payroll','finance','budget','grant','analytics'],
    40)
ON CONFLICT (code) DO NOTHING;

INSERT INTO composition.module_bundle (code, label, subtitle, module_ids, sort_order) VALUES
  ('section8', 'Section 8 company', 'Non-profit: HR, payroll, finance, grants',
    ARRAY['employee','attendance','leave','appraisal','ess','payroll','finance','budget','grant','analytics'], 120),
  ('small_office', 'Small business / MSME', 'HR, payroll, finance, grants',
    ARRAY['employee','attendance','leave','appraisal','ess','payroll','finance','budget','grant','analytics'], 121),
  ('psu', 'PSU / Board', 'Public-sector undertaking: full commercial ERP',
    ARRAY['employee','attendance','leave','recruitment','appraisal','career','ess','payroll','loans','benefits','separation',
          'finance','budget','treasury','revenue','procurement','contract','inventory','asset','works','project','inspection','analytics'], 122)
ON CONFLICT (code) DO NOTHING;
