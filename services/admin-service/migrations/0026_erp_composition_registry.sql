-- admin-service migration 0026 — extend Module Composition to the whole ERP.
--
-- Builds on 0025 (HR-centric registry) to cover the full platform:
--   • adds a `cluster` grouping column to composition.module_registry
--   • adds a composition.module_bundle catalogue (one-click cluster enablement)
--   • re-seeds the registry to 34 modules (Finance backbone, Procure-to-Pay,
--     Delivery, Citizen services, Governance, Insight) with their real
--     hard/soft dependency edges (derived from the live cross-service event map)
--   • extends the 3 org profiles with non-HR rule-packs (accounting_basis,
--     procurement_rulebook, revenue_type, audit_profile) and per-org defaults
--
-- All GLOBAL reference tables (no tenant_id → no RLS, same as 0025). Idempotent:
-- ALTER ... IF NOT EXISTS + ON CONFLICT DO UPDATE. No tenant rows inserted.

-- ── 1. cluster grouping on the registry ───────────────────────────────────
ALTER TABLE composition.module_registry
  ADD COLUMN IF NOT EXISTS cluster text NOT NULL DEFAULT '';

-- ── 2. bundle catalogue (a cluster the tenant can enable in one click) ─────
CREATE TABLE IF NOT EXISTS composition.module_bundle (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  subtitle    text NOT NULL DEFAULT '',
  module_ids  text[] NOT NULL DEFAULT '{}',
  sort_order  integer NOT NULL DEFAULT 0
);

-- ── 3. re-seed the registry (34 modules, with cluster + dependency edges) ──
-- Re-states the 5 core + 12 HR rows from 0025 (now with a cluster) and adds
-- the 17 non-HR business modules. ON CONFLICT keeps this idempotent.
INSERT INTO composition.module_registry (id, name, layer, is_core, cluster, hard_deps, soft_deps, screens, sort_order) VALUES
  -- kernel (always on)
  ('identity',    'Identity & Access',          0, true,  'core',       '{}',                                  '{}',                     ARRAY['Users','Roles','RBAC'],                          10),
  ('org',         'Organisation & Hierarchy',   0, true,  'core',       ARRAY['identity'],                     '{}',                     ARRAY['Org tree','Offices','Positions'],                20),
  ('config',      'Config / Metadata Engine',   0, true,  'core',       ARRAY['identity'],                     '{}',                     ARRAY['Entities','Layouts','Rules','Feature flags'],    30),
  ('workflow',    'Workflow / Maker-Checker',   0, true,  'core',       ARRAY['identity'],                     '{}',                     ARRAY['Approvals'],                                     40),
  ('audit',       'Audit & Notification',       0, true,  'core',       ARRAY['identity'],                     '{}',                     ARRAY['Audit log','Notices'],                           50),
  -- human resources
  ('employee',    'Employee Master (HRIS)',     1, false, 'hr',         ARRAY['org','config'],                 '{}',                     ARRAY['Employee Master','e-Service Book','Onboarding'], 60),
  ('attendance',  'Attendance',                 2, false, 'hr',         ARRAY['employee'],                     '{}',                     ARRAY['Attendance'],                                    70),
  ('leave',       'Leave Management',           2, false, 'hr',         ARRAY['employee','workflow','config'], ARRAY['attendance'],      ARRAY['Leave'],                                         80),
  ('recruitment', 'Recruitment',                2, false, 'hr',         ARRAY['org'],                          ARRAY['employee'],        ARRAY['Manpower','Recruitment & Selection'],            90),
  ('appraisal',   'Appraisal (APAR/PMS)',       2, false, 'hr',         ARRAY['employee','workflow'],          '{}',                     ARRAY['Appraisal'],                                    100),
  ('career',      'Transfer & Promotion',       2, false, 'hr',         ARRAY['employee','workflow'],          '{}',                     ARRAY['Transfers','Promotion','Pay Fixation'],         110),
  ('ess',         'Self-Service & Grievance',   4, false, 'hr',         ARRAY['employee'],                     '{}',                     ARRAY['ESS','Grievance','Reports/MIS'],                115),
  -- payroll & benefits
  ('payroll',     'Payroll & Salary',           3, false, 'payroll',    ARRAY['employee','config','finance'],  ARRAY['attendance','leave','loans'], ARRAY['Payroll & Salary Slip'],            130),
  ('loans',       'Loans & Advances',           3, false, 'payroll',    ARRAY['employee'],                     ARRAY['payroll'],         ARRAY['Loans & Advances'],                             140),
  ('benefits',    'Travel / Medical / LTC',     3, false, 'payroll',    ARRAY['employee'],                     ARRAY['payroll'],         ARRAY['Tour/TA/DA/LTC','Medical/CGHS'],                150),
  ('separation',  'Separation & Pension',       3, false, 'payroll',    ARRAY['employee'],                     ARRAY['payroll'],         ARRAY['Separation','Pension & Settlement'],            160),
  -- finance backbone
  ('finance',     'Finance / General Ledger',   3, false, 'finance',    ARRAY['config'],                       '{}',                     ARRAY['General Ledger','Vouchers'],                    120),
  ('budget',      'Budget & Appropriation',     3, false, 'finance',    ARRAY['finance'],                      '{}',                     ARRAY['Budget preparation','Appropriation','Re-appropriation'], 200),
  ('treasury',    'Treasury & Cash',            3, false, 'finance',    ARRAY['finance'],                      ARRAY['budget'],          ARRAY['Treasury','PD accounts','Cheque/DD'],           210),
  ('revenue',     'Revenue & Receipts',         3, false, 'finance',    ARRAY['finance'],                      '{}',                     ARRAY['Demands','Collections','Challan/Receipt'],      220),
  -- procure-to-pay
  ('procurement', 'Procurement',                3, false, 'p2p',        ARRAY['finance','budget','workflow'],  ARRAY['contract','legal'],ARRAY['Indent','Tender','PO','GRN'],                   230),
  ('contract',    'Contracts',                  3, false, 'p2p',        ARRAY['workflow'],                     ARRAY['procurement'],     ARRAY['Contracts','Milestones','Amendments'],          240),
  ('inventory',   'Inventory & Stores',         3, false, 'p2p',        ARRAY['finance'],                      ARRAY['procurement'],     ARRAY['Stores','GRN','Issue/Return'],                  250),
  ('asset',       'Asset Management',           3, false, 'p2p',        ARRAY['finance'],                      ARRAY['procurement','works','workflow'], ARRAY['Asset register','Depreciation','Disposal'], 260),
  -- delivery (projects, works, grants)
  ('works',       'Works & Contracts Exec',     3, false, 'delivery',   ARRAY['finance','budget'],             ARRAY['procurement','grant'], ARRAY['Works estimate','BOQ','RA bill'],           270),
  ('project',     'Project Management',         2, false, 'delivery',   ARRAY['config'],                       ARRAY['grant','finance'], ARRAY['Projects','WBS','Milestones'],                  280),
  ('grant',       'Grants & Schemes',           3, false, 'delivery',   ARRAY['finance','budget'],             ARRAY['project'],         ARRAY['Schemes','Sanction','Utilisation (UC)'],        290),
  -- citizen services (G2C)
  ('citizen',     'Citizen Services',           2, false, 'citizen',    ARRAY['workflow'],                     '{}',                     ARRAY['Services catalogue','Applications','Grievances'], 300),
  ('crm',         'CRM',                        2, false, 'citizen',    '{}',                                  '{}',                     ARRAY['Contacts','Leads','Cases'],                     310),
  ('helpdesk',    'Helpdesk & SLA',             2, false, 'citizen',    '{}',                                  ARRAY['citizen','crm'],   ARRAY['Tickets','SLA','Service catalogue'],            320),
  ('knowledge',   'Knowledge Base',             2, false, 'citizen',    '{}',                                  ARRAY['helpdesk'],        ARRAY['Articles','FAQ','Categories'],                  330),
  -- governance & legal
  ('legal',       'Legal / RTI / Vigilance',    2, false, 'governance', ARRAY['workflow'],                     '{}',                     ARRAY['Cases','RTI','Vigilance'],                      340),
  ('inspection',  'Inspection & Enforcement',   2, false, 'governance', ARRAY['employee','workflow'],          '{}',                     ARRAY['Inspections','Checklists','Findings'],          350),
  -- insight
  ('analytics',   'Analytics & MIS',            4, false, 'insight',    ARRAY['config'],                       ARRAY['finance','procurement','grant'], ARRAY['Dashboards','MIS reports','KPIs'],   360)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, layer = EXCLUDED.layer, is_core = EXCLUDED.is_core, cluster = EXCLUDED.cluster,
  hard_deps = EXCLUDED.hard_deps, soft_deps = EXCLUDED.soft_deps,
  screens = EXCLUDED.screens, sort_order = EXCLUDED.sort_order;

-- ── 4. seed the bundle catalogue (8 clusters; core is implicit, not a bundle)
INSERT INTO composition.module_bundle (code, label, subtitle, module_ids, sort_order) VALUES
  ('hr',         'Human Resources',   'Employee lifecycle',        ARRAY['employee','attendance','leave','recruitment','appraisal','career','ess'], 10),
  ('payroll',    'Payroll & Benefits','Pay, loans, pension',       ARRAY['payroll','loans','benefits','separation'],                                20),
  ('finance',    'Finance Backbone',  'GL, budget, treasury',      ARRAY['finance','budget','treasury','revenue'],                                  30),
  ('p2p',        'Procure-to-Pay',    'Procurement to assets',     ARRAY['procurement','contract','inventory','asset'],                             40),
  ('delivery',   'Projects & Grants', 'Works, projects, grants',   ARRAY['works','project','grant'],                                                50),
  ('citizen',    'Citizen Services',  'G2C, CRM, helpdesk',        ARRAY['citizen','crm','helpdesk','knowledge'],                                   60),
  ('governance', 'Governance & Legal','Legal, RTI, inspection',    ARRAY['legal','inspection'],                                                     70),
  ('insight',    'Analytics & MIS',   'Dashboards & reports',      ARRAY['analytics'],                                                              80)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label, subtitle = EXCLUDED.subtitle,
  module_ids = EXCLUDED.module_ids, sort_order = EXCLUDED.sort_order;

-- ── 5. extend org profiles: non-HR rule-packs + full-ERP default modules ──
-- Government — does the widest set; fund accounting + GFR/GeM + CAG audit.
UPDATE composition.org_profile SET
  rule_packs = rule_packs || '{"accounting_basis":"govt_fund","procurement_rulebook":"gfr_gem","revenue_type":"tax_fee_challan","audit_profile":"cag_pac_gfr"}'::jsonb,
  default_modules = ARRAY[
    'employee','attendance','leave','recruitment','appraisal','career','ess',
    'payroll','loans','benefits','separation',
    'finance','budget','treasury','revenue',
    'procurement','contract','inventory','asset',
    'works','project','grant',
    'citizen','helpdesk','knowledge',
    'legal','inspection','analytics']
WHERE code = 'govt_dept';

-- PSU — commercial accrual + own procurement manual; no G2C citizen services.
UPDATE composition.org_profile SET
  rule_packs = rule_packs || '{"accounting_basis":"commercial_accrual","procurement_rulebook":"psu_manual","revenue_type":"sales_service","audit_profile":"cag_dpe"}'::jsonb,
  default_modules = ARRAY[
    'employee','attendance','leave','recruitment','appraisal','career','ess',
    'payroll','loans','benefits','separation',
    'finance','budget','treasury','revenue',
    'procurement','contract','inventory','asset',
    'works','project','inspection','analytics']
WHERE code = 'psu';

-- Section-8 — commercial accrual + FCRA; minimal footprint, grant-funded.
UPDATE composition.org_profile SET
  rule_packs = rule_packs || '{"accounting_basis":"commercial_accrual_fcra","procurement_rulebook":"private","revenue_type":"grants_donations","audit_profile":"fcra_12a_80g"}'::jsonb,
  default_modules = ARRAY[
    'employee','attendance','leave','appraisal','ess',
    'payroll',
    'finance','budget',
    'grant','analytics']
WHERE code = 'small_office';
