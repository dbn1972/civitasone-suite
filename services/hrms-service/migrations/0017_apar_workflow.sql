-- 0017_apar_workflow.sql
-- APAR / SPARROW multi-authority workflow.
-- Additive + idempotent only. Extends appraisal.hrms_appraisals with assigned
-- stage-owner officers + server-computed overall grade/band, and adds
-- per-attribute scores and an immutable stage-history.

-- --- 1. extend the parent APAR row with stage owners and computed result ----
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS reporting_officer_id  uuid;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS reviewing_officer_id  uuid;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS accepting_authority_id uuid;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS self_appraisal        text;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS reporting_pen_picture text;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS reviewing_remarks     text;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS accepting_remarks     text;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS overall_grade         numeric(4,2);
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS overall_band          varchar(16);
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS disclosed_at          timestamptz;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS representation        text;
ALTER TABLE appraisal.hrms_appraisals ADD COLUMN IF NOT EXISTS representation_due     date;

-- widen status CHECK to include disclosure + representation stages
ALTER TABLE appraisal.hrms_appraisals DROP CONSTRAINT IF EXISTS hrms_appraisals_status_check;
ALTER TABLE appraisal.hrms_appraisals ADD CONSTRAINT hrms_appraisals_status_check
  CHECK (status IN (
    'pending','in_review','completed',
    'self_pending','reporting_officer','reviewing_officer','accepting_authority',
    'disclosed','representation','finalised'
  ));

-- --- 2. per-attribute scores (1..10) given by the Reporting Officer ---------
CREATE TABLE IF NOT EXISTS appraisal.hrms_apar_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  appraisal_id  uuid NOT NULL,
  attribute     varchar(64) NOT NULL,
  weight        numeric(5,2) NOT NULL DEFAULT 1,
  score         integer NOT NULL,
  remarks       text,
  scored_by     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_apar_scores_range CHECK (score >= 1 AND score <= 10),
  CONSTRAINT hrms_apar_scores_uq UNIQUE (appraisal_id, attribute)
);
CREATE INDEX IF NOT EXISTS hrms_apar_scores_appraisal_idx
  ON appraisal.hrms_apar_scores (tenant_id, appraisal_id);

-- --- 3. immutable stage history (who / when / scores snapshot / remarks) ----
CREATE TABLE IF NOT EXISTS appraisal.hrms_apar_stage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  appraisal_id  uuid NOT NULL,
  from_stage    varchar(24),
  to_stage      varchar(24) NOT NULL,
  actor_id      uuid NOT NULL,
  actor_role    varchar(32) NOT NULL,
  remarks       text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hrms_apar_stage_history_appraisal_idx
  ON appraisal.hrms_apar_stage_history (tenant_id, appraisal_id, created_at);
