-- hrms-service migration 0065 — Engagement-type policy framework.
--
-- Closes the DIC gap: an employee-type must carry a full POLICY PACK so pay,
-- statutory, tax, leave, gratuity and separation can branch per engagement
-- type (Pay-scale / Contractual / Consultant / Third-Party / Apprentice).
--
--   1. Extends employee.hrms_employee_types (per-tenant master) with the
--      missing statutory / tax / terminal / payment-route columns.
--   2. Adds a GLOBAL canonical catalogue (employee.engagement_type_catalogue,
--      no tenant_id -> no RLS, same rationale as a lookup) seeded with the 5
--      legally-distinct DIC engagement types + correct policy, so every tenant
--      resolves a sane default even before customising its own master.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + ON CONFLICT DO UPDATE. No tenant rows.

-- 1. Extend the per-tenant type master ────────────────────────────────────
ALTER TABLE employee.hrms_employee_types
  ADD COLUMN IF NOT EXISTS category            varchar(24)  NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS payment_route        varchar(16) NOT NULL DEFAULT 'payroll',
  ADD COLUMN IF NOT EXISTS tax_section          varchar(8)  NOT NULL DEFAULT '192',
  ADD COLUMN IF NOT EXISTS statutory_pf         boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS statutory_esi        boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS statutory_nps        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eligible_for_gratuity boolean    NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS eligible_for_bonus   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leave_encashment     boolean     NOT NULL DEFAULT false;

-- 2. Global canonical catalogue (reference data; no tenant, no RLS) ────────
CREATE TABLE IF NOT EXISTS employee.engagement_type_catalogue (
  category               varchar(24) PRIMARY KEY,
  label                  varchar(80)  NOT NULL,
  description            varchar(300) NOT NULL DEFAULT '',
  eligible_for_leave     boolean NOT NULL DEFAULT true,
  eligible_for_payroll   boolean NOT NULL DEFAULT true,
  eligible_for_appraisal boolean NOT NULL DEFAULT true,
  payment_route          varchar(16) NOT NULL DEFAULT 'payroll',   -- payroll|invoice|agency|stipend|none
  pay_mode               varchar(16) NOT NULL DEFAULT 'monthly',   -- monthly|consolidated|stipend|none
  tax_section            varchar(8)  NOT NULL DEFAULT '192',       -- 192|194J|194C|stipend|none
  statutory_pf           boolean NOT NULL DEFAULT true,
  statutory_esi          boolean NOT NULL DEFAULT true,
  statutory_nps          boolean NOT NULL DEFAULT false,
  eligible_for_gratuity  boolean NOT NULL DEFAULT true,
  eligible_for_bonus     boolean NOT NULL DEFAULT false,
  leave_encashment       boolean NOT NULL DEFAULT false,
  default_probation_months integer NOT NULL DEFAULT 0,
  max_contract_months    integer,      -- null = unlimited
  sort_order             integer NOT NULL DEFAULT 0
);

INSERT INTO employee.engagement_type_catalogue
  (category, label, description, eligible_for_leave, eligible_for_payroll, eligible_for_appraisal,
   payment_route, pay_mode, tax_section, statutory_pf, statutory_esi, statutory_nps,
   eligible_for_gratuity, eligible_for_bonus, leave_encashment, default_probation_months, max_contract_months, sort_order)
VALUES
  ('pay_scale',  'Pay-scale Employee', 'Government (7th CPC) pay scale; EPF/NPS, gratuity, full leave.',
     true,  true,  true,  'payroll', 'monthly',      '192',     true,  true,  true,  true,  false, true,  24, NULL, 10),
  ('contractual','Contractual',        'Consolidated / scale-linked pay; EPF/ESI; gratuity if >= 5y.',
     true,  true,  true,  'payroll', 'consolidated', '192',     true,  true,  false, true,  true,  true,  6,  60,   20),
  ('consultant', 'Invoice Consultant', 'Self-employed; paid on invoice (194J + GST); NOT in payroll; no statutory/leave.',
     false, false, true,  'invoice', 'none',         '194J',    false, false, false, false, false, false, 0,  36,   30),
  ('third_party','Third-Party (Agency)','Agency-deployed; paid to agency (194C); DIC is principal employer (CLRA).',
     false, false, false, 'agency',  'none',         '194C',    false, false, false, false, false, false, 0,  NULL, 40),
  ('apprentice', 'Apprentice',         'Apprentices Act / NAPS; stipend only; no PF/ESI/gratuity; Act-defined leave.',
     true,  false, false, 'stipend', 'stipend',      'stipend', false, false, false, false, false, false, 0,  24,   50)
ON CONFLICT (category) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description,
  eligible_for_leave = EXCLUDED.eligible_for_leave, eligible_for_payroll = EXCLUDED.eligible_for_payroll,
  eligible_for_appraisal = EXCLUDED.eligible_for_appraisal, payment_route = EXCLUDED.payment_route,
  pay_mode = EXCLUDED.pay_mode, tax_section = EXCLUDED.tax_section,
  statutory_pf = EXCLUDED.statutory_pf, statutory_esi = EXCLUDED.statutory_esi, statutory_nps = EXCLUDED.statutory_nps,
  eligible_for_gratuity = EXCLUDED.eligible_for_gratuity, eligible_for_bonus = EXCLUDED.eligible_for_bonus,
  leave_encashment = EXCLUDED.leave_encashment, default_probation_months = EXCLUDED.default_probation_months,
  max_contract_months = EXCLUDED.max_contract_months, sort_order = EXCLUDED.sort_order;

-- Grant the runtime service role read access to the new reference table
-- (mirrors migration 0062; other employee.* tables are already granted).
GRANT SELECT ON employee.engagement_type_catalogue TO hrms_svc;
