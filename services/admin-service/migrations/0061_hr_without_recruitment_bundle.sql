-- 0061_hr_without_recruitment_bundle.sql
-- M8 (module-sale gap): HRMS without Recruitment. Recruitment is its own catalogue module; APAR (module `appraisal`),
-- the employee data-reveal (core, /v1/hrms/pii/reveal) and Transfer & Promotion (`career`) do not depend on it.
-- This adds ONE offer bundle so a client can be sold "HR without Recruitment" in one click. Purely additive and
-- idempotent: the existing `hr` bundle and every tenant's entitlements are untouched.
INSERT INTO composition.module_bundle (code, label, subtitle, module_ids, sort_order) VALUES
  ('hr_no_recruitment', 'Human Resources (without Recruitment)', 'Employee lifecycle, appraisal (APAR) and transfers; no recruitment',
   ARRAY['employee','attendance','leave','appraisal','career','ess'], 11)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label, subtitle = EXCLUDED.subtitle,
  module_ids = EXCLUDED.module_ids, sort_order = EXCLUDED.sort_order;
