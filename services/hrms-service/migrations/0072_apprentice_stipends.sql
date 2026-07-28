-- 0072_apprentice_stipends.sql
-- DIC Apprentice / NAPS module (Phase 3). Apprentices (engagement type
-- 'apprentice') draw a monthly STIPEND under the Apprentices Act — not salary,
-- not an invoice. The stipend is pro-rated by attendance, and the government
-- reimburses the employer a share (NAPS, default 25% capped at ₹1,500) via DBT.
-- No PF/ESI/TDS. Money in paise (bigint). Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS apprenticeship.hrms_apprentice_stipends;
--           DROP TABLE IF EXISTS apprenticeship.hrms_apprenticeships;
--           DROP SCHEMA IF EXISTS apprenticeship;

CREATE SCHEMA IF NOT EXISTS apprenticeship;

CREATE TABLE IF NOT EXISTS apprenticeship.hrms_apprenticeships (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  apprentice_id             uuid NOT NULL,                    -- hrms_employees.id (employeeType apprentice)
  naps_id                   varchar(24),
  trade                     varchar(120),
  qualification             varchar(24) NOT NULL DEFAULT 'other', -- school | iti | diploma | graduate | other
  monthly_stipend_minor     bigint NOT NULL,                  -- agreed monthly stipend
  naps_reimb_pct_bps        integer NOT NULL DEFAULT 2500,    -- 25%
  naps_reimb_cap_minor      bigint NOT NULL DEFAULT 150000,   -- ₹1,500 per month
  training_start            date NOT NULL,
  training_end              date,
  status                    varchar(16) NOT NULL DEFAULT 'active', -- active | completed | terminated
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  updated_by                uuid NOT NULL,
  CONSTRAINT hrms_apprenticeships_qual_check
    CHECK (qualification IN ('school','iti','diploma','graduate','other')),
  CONSTRAINT hrms_apprenticeships_status_check
    CHECK (status IN ('active','completed','terminated')),
  CONSTRAINT hrms_apprenticeships_stipend_positive CHECK (monthly_stipend_minor > 0)
);

CREATE TABLE IF NOT EXISTS apprenticeship.hrms_apprentice_stipends (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  apprenticeship_id         uuid NOT NULL,
  month                     varchar(7) NOT NULL,              -- YYYY-MM
  working_days              integer NOT NULL,
  days_present              integer NOT NULL,
  monthly_stipend_minor     bigint NOT NULL,                  -- snapshot of the agreed rate
  naps_reimb_pct_bps        integer NOT NULL DEFAULT 2500,    -- snapshot of the NAPS % at submit
  naps_reimb_cap_minor      bigint NOT NULL DEFAULT 150000,   -- snapshot of the NAPS cap at submit
  gross_stipend_minor       bigint NOT NULL DEFAULT 0,        -- pro-rated for attendance
  naps_reimb_minor          bigint NOT NULL DEFAULT 0,        -- govt share (paid to employer)
  employer_cost_minor       bigint NOT NULL DEFAULT 0,        -- gross - naps_reimb
  status                    varchar(16) NOT NULL DEFAULT 'submitted',
  remarks                   text,
  approver_remarks          text,
  payment_ref               varchar(64),
  submitted_at              timestamptz NOT NULL DEFAULT now(),
  verified_by               uuid,
  verified_at               timestamptz,
  approved_by               uuid,
  approved_at               timestamptz,
  paid_at                   timestamptz,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  updated_by                uuid NOT NULL,
  CONSTRAINT hrms_apprentice_stipends_status_check
    CHECK (status IN ('submitted','verified','approved','rejected','paid')),
  CONSTRAINT hrms_apprentice_stipends_days_check
    CHECK (working_days > 0 AND days_present >= 0 AND days_present <= working_days),
  CONSTRAINT hrms_apprentice_stipends_month_fmt CHECK (month ~ '^[0-9]{4}-[0-9]{2}$')
);

-- Idempotent add of the NAPS snapshot columns for an already-created table.
ALTER TABLE apprenticeship.hrms_apprentice_stipends
  ADD COLUMN IF NOT EXISTS naps_reimb_pct_bps  integer NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS naps_reimb_cap_minor bigint NOT NULL DEFAULT 150000;

-- One stipend run per apprenticeship per month (idempotent re-submit guard).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_apprentice_stipends_month_uq
  ON apprenticeship.hrms_apprentice_stipends (tenant_id, apprenticeship_id, month);
CREATE INDEX IF NOT EXISTS hrms_apprenticeships_appr_idx
  ON apprenticeship.hrms_apprenticeships (tenant_id, apprentice_id);
CREATE INDEX IF NOT EXISTS hrms_apprentice_stipends_ap_idx
  ON apprenticeship.hrms_apprentice_stipends (tenant_id, apprenticeship_id);
CREATE INDEX IF NOT EXISTS hrms_apprentice_stipends_stat_idx
  ON apprenticeship.hrms_apprentice_stipends (tenant_id, status);

-- RLS (FORCE, app.tenant_id GUC — same pattern as consultant / agency).
ALTER TABLE apprenticeship.hrms_apprenticeships ENABLE ROW LEVEL SECURITY;
ALTER TABLE apprenticeship.hrms_apprenticeships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_apprenticeships_tenant_isolation ON apprenticeship.hrms_apprenticeships;
CREATE POLICY hrms_apprenticeships_tenant_isolation ON apprenticeship.hrms_apprenticeships
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE apprenticeship.hrms_apprentice_stipends ENABLE ROW LEVEL SECURITY;
ALTER TABLE apprenticeship.hrms_apprentice_stipends FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_apprentice_stipends_tenant_isolation ON apprenticeship.hrms_apprentice_stipends;
CREATE POLICY hrms_apprentice_stipends_tenant_isolation ON apprenticeship.hrms_apprentice_stipends
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Runtime role grants (brand-new schema does not inherit default privileges).
GRANT USAGE ON SCHEMA apprenticeship TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON apprenticeship.hrms_apprenticeships TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON apprenticeship.hrms_apprentice_stipends TO hrms_svc;
