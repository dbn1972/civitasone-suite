-- 0102_posh_icc_performance_apar.sql
-- Sprint 4 (T25–T29): POSH / ICC Case Management.
-- Sprint 5 (T30–T34): Performance & APAR completion.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC.
--
-- Rollback: DROP TABLE IF EXISTS disciplinary.hrms_icc_complaints, disciplinary.hrms_icc_hearings,
--   disciplinary.hrms_icc_timelines, disciplinary.hrms_icc_annual_reports,
--   appraisal.hrms_360_feedback, appraisal.hrms_calibration_sessions,
--   appraisal.hrms_bell_curve_results, appraisal.hrms_apar_disclosures, appraisal.hrms_rating_appeals;

SET lock_timeout = '5s';

-- ── Sprint 4: POSH / ICC ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disciplinary.hrms_icc_complaints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, complainant_id uuid NOT NULL, respondent_id uuid,
  summary         text NOT NULL,
  filed_at        timestamptz NOT NULL DEFAULT now(),
  status          varchar(16) NOT NULL DEFAULT 'filed',
  confidential    boolean NOT NULL DEFAULT true,
  icc_members_only boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_icc_status_check CHECK (status IN ('filed','investigating','hearing','resolved','dismissed','withdrawn'))
);
CREATE INDEX IF NOT EXISTS hrms_icc_comp_tenant_idx ON disciplinary.hrms_icc_complaints (tenant_id, status);

CREATE TABLE IF NOT EXISTS disciplinary.hrms_icc_hearings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, complaint_id uuid NOT NULL,
  hearing_date    date NOT NULL, notes text, finding varchar(24),
  conducted_by    uuid, created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS hrms_icc_hear_comp_idx ON disciplinary.hrms_icc_hearings (tenant_id, complaint_id);

CREATE TABLE IF NOT EXISTS disciplinary.hrms_icc_timelines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, complaint_id uuid NOT NULL,
  milestone       varchar(32) NOT NULL, due_date date NOT NULL,
  completed_at    timestamptz, escalated_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hrms_icc_tl_comp_idx ON disciplinary.hrms_icc_timelines (tenant_id, complaint_id);

CREATE TABLE IF NOT EXISTS disciplinary.hrms_icc_annual_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, year integer NOT NULL,
  total_filed     integer NOT NULL DEFAULT 0, total_resolved integer NOT NULL DEFAULT 0,
  total_pending   integer NOT NULL DEFAULT 0,
  generated_at    timestamptz NOT NULL DEFAULT now(), generated_by uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hrms_icc_annual_uq ON disciplinary.hrms_icc_annual_reports (tenant_id, year);

-- ── Sprint 5: Performance & APAR ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appraisal.hrms_360_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, appraisal_id uuid NOT NULL, reviewer_id uuid NOT NULL,
  relationship    varchar(24) NOT NULL, ratings text, comments text,
  submitted_at    timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hrms_360fb_appr_idx ON appraisal.hrms_360_feedback (tenant_id, appraisal_id);

CREATE TABLE IF NOT EXISTS appraisal.hrms_calibration_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, period_id uuid,
  status          varchar(16) NOT NULL DEFAULT 'open',
  conducted_at    timestamptz, conducted_by uuid, notes text,
  created_at      timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_calib_status_check CHECK (status IN ('open','closed','cancelled'))
);

CREATE TABLE IF NOT EXISTS appraisal.hrms_bell_curve_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, session_id uuid NOT NULL,
  band            varchar(24) NOT NULL, target_percent integer NOT NULL,
  actual_count    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hrms_bell_sess_idx ON appraisal.hrms_bell_curve_results (tenant_id, session_id);

CREATE TABLE IF NOT EXISTS appraisal.hrms_apar_disclosures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, appraisal_id uuid NOT NULL, employee_id uuid NOT NULL,
  disclosed_at    timestamptz NOT NULL DEFAULT now(),
  representation_filed boolean NOT NULL DEFAULT false,
  representation_text text, representation_at timestamptz,
  outcome         varchar(16), decided_by uuid, decided_at timestamptz,
  version         integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS hrms_apar_disc_idx ON appraisal.hrms_apar_disclosures (tenant_id, appraisal_id);

CREATE TABLE IF NOT EXISTS appraisal.hrms_rating_appeals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL, appraisal_id uuid NOT NULL, employee_id uuid NOT NULL,
  appeal_reason   text NOT NULL, status varchar(16) NOT NULL DEFAULT 'filed',
  pip_linked      boolean NOT NULL DEFAULT false, pip_plan_id uuid,
  filed_at        timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid, decided_at timestamptz, outcome varchar(16),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_appeal_status_check CHECK (status IN ('filed','reviewing','upheld','rejected','withdrawn'))
);
CREATE INDEX IF NOT EXISTS hrms_appeal_appr_idx ON appraisal.hrms_rating_appeals (tenant_id, appraisal_id);

-- Batch RLS
DO $$ DECLARE t text; s text; BEGIN
  FOR t, s IN VALUES
    ('hrms_icc_complaints','disciplinary'),('hrms_icc_hearings','disciplinary'),
    ('hrms_icc_timelines','disciplinary'),('hrms_icc_annual_reports','disciplinary'),
    ('hrms_360_feedback','appraisal'),('hrms_calibration_sessions','appraisal'),
    ('hrms_bell_curve_results','appraisal'),('hrms_apar_disclosures','appraisal'),
    ('hrms_rating_appeals','appraisal')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', s, t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', s, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I.%I', t, s, t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t, s, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO hrms_svc', s, t);
  END LOOP;
END $$;
