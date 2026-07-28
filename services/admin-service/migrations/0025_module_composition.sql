-- admin-service migration 0025 — Module Composition & Org-Profile onboarding.
--
-- Adds a GLOBAL module registry (with a hard/soft dependency graph) and an
-- org-profile catalogue (Govt / PSU / Section-8) as platform reference data
-- (no tenant_id → deliberately NOT row-level-secured, same rationale as a
-- country/currency lookup: every tenant composes from the same catalogue),
-- plus TENANT-scoped entitlement + profile tables that ARE FORCE-RLS'd with
-- the standard tenant_isolation policy (mirrors migration 0005).
--
-- Idempotent: CREATE ... IF NOT EXISTS + ON CONFLICT DO UPDATE seeds. Safe to
-- re-run. Seeding the registry/profile *catalogue* here is legitimate schema
-- reference data, NOT demo tenant data — no tenant rows are inserted.

CREATE SCHEMA IF NOT EXISTS composition;

-- NOTE: the tenant_isolation policies below reference current_tenant_id(),
-- which is created by migration 0005 (always applied before 0025 by the
-- ordered migration runner). It is intentionally NOT redefined here: under the
-- least-privilege admin_svc role this migration is applied with, redefining a
-- function owned by the bootstrap role would fail ("must be owner").

-- ── GLOBAL reference: module registry (dependency graph) ──────────────────
CREATE TABLE IF NOT EXISTS composition.module_registry (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  layer       integer NOT NULL,
  is_core     boolean NOT NULL DEFAULT false,
  hard_deps   text[]  NOT NULL DEFAULT '{}',
  soft_deps   text[]  NOT NULL DEFAULT '{}',
  screens     text[]  NOT NULL DEFAULT '{}',
  sort_order  integer NOT NULL DEFAULT 0
);

-- ── GLOBAL reference: org-profile catalogue ───────────────────────────────
CREATE TABLE IF NOT EXISTS composition.org_profile (
  code            text PRIMARY KEY,
  label           text NOT NULL,
  subtitle        text NOT NULL DEFAULT '',
  rule_packs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  terminology     jsonb NOT NULL DEFAULT '{}'::jsonb,
  statutory       jsonb NOT NULL DEFAULT '{}'::jsonb,
  reservation     boolean NOT NULL DEFAULT false,
  default_modules text[]  NOT NULL DEFAULT '{}',
  sort_order      integer NOT NULL DEFAULT 0
);

-- ── TENANT data: modules a tenant has selected (source-of-truth = 'user') ──
CREATE TABLE IF NOT EXISTS composition.tenant_entitlement (
  tenant_id   uuid NOT NULL,
  module_id   text NOT NULL REFERENCES composition.module_registry(id),
  source      text NOT NULL CHECK (source IN ('user','dep','core')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  PRIMARY KEY (tenant_id, module_id)
);

-- ── TENANT data: the org-profile a tenant onboarded with ──────────────────
CREATE TABLE IF NOT EXISTS composition.tenant_profile (
  tenant_id    uuid PRIMARY KEY,
  profile_code text NOT NULL REFERENCES composition.org_profile(code),
  applied_at   timestamptz NOT NULL DEFAULT now(),
  applied_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

-- ── RLS on tenant tables (mirror 0005 tenant_isolation) ───────────────────
ALTER TABLE composition.tenant_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE composition.tenant_entitlement FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON composition.tenant_entitlement;
CREATE POLICY tenant_isolation ON composition.tenant_entitlement
  USING (tenant_id = current_tenant_id());

ALTER TABLE composition.tenant_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE composition.tenant_profile FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON composition.tenant_profile;
CREATE POLICY tenant_isolation ON composition.tenant_profile
  USING (tenant_id = current_tenant_id());

-- ── Seed: module registry (17 modules, layered dependency graph) ──────────
INSERT INTO composition.module_registry (id, name, layer, is_core, hard_deps, soft_deps, screens, sort_order) VALUES
  ('identity',    'Identity & Access',          0, true,  '{}',                                  '{}',                    ARRAY['Users','Roles','RBAC'],                                   10),
  ('org',         'Organisation & Hierarchy',   0, true,  ARRAY['identity'],                     '{}',                    ARRAY['Org tree','Offices','Positions'],                         20),
  ('config',      'Config / Metadata Engine',   0, true,  ARRAY['identity'],                     '{}',                    ARRAY['Entities','Layouts','Rules','Feature flags'],             30),
  ('workflow',    'Workflow / Maker-Checker',   0, true,  ARRAY['identity'],                     '{}',                    ARRAY['Approvals'],                                              40),
  ('audit',       'Audit & Notification',       0, true,  ARRAY['identity'],                     '{}',                    ARRAY['Audit log','Notices'],                                    50),
  ('employee',    'Employee Master (HRIS)',     1, false, ARRAY['org','config'],                 '{}',                    ARRAY['Employee Master','e-Service Book','Onboarding'],          60),
  ('attendance',  'Attendance',                 2, false, ARRAY['employee'],                     '{}',                    ARRAY['Attendance'],                                             70),
  ('leave',       'Leave Management',           2, false, ARRAY['employee','workflow','config'], ARRAY['attendance'],     ARRAY['Leave'],                                                  80),
  ('recruitment', 'Recruitment',                2, false, ARRAY['org'],                          ARRAY['employee'],       ARRAY['Manpower','Recruitment & Selection'],                     90),
  ('appraisal',   'Appraisal (APAR/PMS)',       2, false, ARRAY['employee','workflow'],          '{}',                    ARRAY['Appraisal'],                                             100),
  ('career',      'Transfer & Promotion',       2, false, ARRAY['employee','workflow'],          '{}',                    ARRAY['Transfers','Promotion','Pay Fixation'],                  110),
  ('finance',     'Finance / GL',               3, false, ARRAY['config'],                       '{}',                    ARRAY['General Ledger','Vouchers'],                             120),
  ('payroll',     'Payroll & Salary',           3, false, ARRAY['employee','config','finance'],  ARRAY['attendance','leave','loans'], ARRAY['Payroll & Salary Slip'],                    130),
  ('loans',       'Loans & Advances',           3, false, ARRAY['employee'],                     ARRAY['payroll'],        ARRAY['Loans & Advances'],                                      140),
  ('benefits',    'Travel / Medical / LTC',     3, false, ARRAY['employee'],                     ARRAY['payroll'],        ARRAY['Tour/TA/DA/LTC','Medical/CGHS'],                         150),
  ('separation',  'Separation & Pension',       3, false, ARRAY['employee'],                     ARRAY['payroll'],        ARRAY['Separation','Pension & Settlement'],                     160),
  ('ess',         'Self-Service & Grievance',   4, false, ARRAY['employee'],                     '{}',                    ARRAY['ESS','Grievance','Reports/MIS'],                         170)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, layer = EXCLUDED.layer, is_core = EXCLUDED.is_core,
  hard_deps = EXCLUDED.hard_deps, soft_deps = EXCLUDED.soft_deps,
  screens = EXCLUDED.screens, sort_order = EXCLUDED.sort_order;

-- ── Seed: org-profile catalogue (aligned to admin edition codes) ──────────
INSERT INTO composition.org_profile (code, label, subtitle, rule_packs, terminology, statutory, reservation, default_modules, sort_order) VALUES
  ('govt_dept', 'Government', 'Dept / Municipal / PSE',
    '{"pay":"7th_cpc","leave":"ccs","appraisal":"apar_dpc","separation":"pension_dcrg"}'::jsonb,
    '{"post":"Cadre / Pay Level","unit":"Department","strength":"Sanctioned post","pay":"Basic + DA + HRA (matrix)"}'::jsonb,
    '{"gpf":true,"nps":true,"tds":true,"pt":true,"epf":false,"esi":false}'::jsonb,
    true,
    ARRAY['employee','attendance','leave','recruitment','appraisal','career','payroll','finance','loans','benefits','separation','ess'],
    10),
  ('psu', 'PSU / Board', 'Public-sector undertaking',
    '{"pay":"ida_cda","leave":"psu","appraisal":"pms_prp","separation":"epf_gratuity_superann"}'::jsonb,
    '{"post":"Grade / Scale","unit":"Division","strength":"Sanctioned strength","pay":"Basic + IDA + perks (CTC)"}'::jsonb,
    '{"epf":true,"esi":true,"gratuity":true,"bonus":true,"pt":true,"tds":true}'::jsonb,
    true,
    ARRAY['employee','attendance','leave','recruitment','appraisal','career','payroll','finance','loans','benefits','separation','ess'],
    20),
  ('small_office', 'Section-8 Company', 'Non-profit / private',
    '{"pay":"ctc","leave":"shops_estab","appraisal":"okr","separation":"epf_gratuity"}'::jsonb,
    '{"post":"Designation","unit":"Department","strength":"Approved headcount","pay":"CTC (Basic+HRA+Special+PF)"}'::jsonb,
    '{"epf":true,"esi":true,"gratuity":true,"pt":true,"tds":true}'::jsonb,
    false,
    ARRAY['employee','attendance','leave','appraisal','payroll','finance','ess'],
    30)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label, subtitle = EXCLUDED.subtitle, rule_packs = EXCLUDED.rule_packs,
  terminology = EXCLUDED.terminology, statutory = EXCLUDED.statutory,
  reservation = EXCLUDED.reservation, default_modules = EXCLUDED.default_modules,
  sort_order = EXCLUDED.sort_order;
