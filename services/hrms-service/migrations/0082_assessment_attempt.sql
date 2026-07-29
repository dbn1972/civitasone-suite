-- 0082_assessment_attempt.sql
-- Assessment management — runtime (checklist R-RA-0124/0126/0127/0129/0130/0131).
--   • hrms_assessment_schedules — a scheduled sitting of a blueprint across slots,
--     centres or online windows (R-RA-0126), carrying an IMMUTABLE assembled paper
--     (question + section + marks + answer-key snapshot) so the exam is reproducible
--     and immune to later question-bank edits.
--   • hrms_assessment_attempts — one candidate's attempt: per-candidate randomised
--     question order (R-RA-0124), identity verification (R-RA-0129), reasonable
--     accommodation / extra time (R-RA-0127), personal deadline, and the evaluated
--     section/total scores + provisional result.
--   • hrms_assessment_responses — per-question responses, auto-saved for crash
--     recovery (R-RA-0130) and auto-scored for objective types (R-RA-0131).
-- Extends the `assessment` schema. FORCE RLS. Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS assessment.hrms_assessment_responses,
--           assessment.hrms_assessment_attempts, assessment.hrms_assessment_schedules;

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  blueprint_id   uuid NOT NULL,
  title          varchar(256) NOT NULL,
  mode           varchar(16) NOT NULL DEFAULT 'online',   -- online | centre | hybrid
  window_start   timestamptz NOT NULL,
  window_end     timestamptz NOT NULL,
  slots          jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{label,start,end,centre,capacity}] (R-RA-0126)
  paper          jsonb NOT NULL DEFAULT '[]'::jsonb,       -- immutable [{questionId,section,marks,qtype,answerKey}]
  total_marks    integer NOT NULL DEFAULT 0,
  status         varchar(16) NOT NULL DEFAULT 'scheduled', -- scheduled | open | closed | cancelled
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  CONSTRAINT hrms_assessment_schedules_mode_check   CHECK (mode IN ('online','centre','hybrid')),
  CONSTRAINT hrms_assessment_schedules_status_check CHECK (status IN ('scheduled','open','closed','cancelled')),
  CONSTRAINT hrms_assessment_schedules_window_check CHECK (window_end > window_start)
);
CREATE INDEX IF NOT EXISTS hrms_assessment_schedules_bp_idx
  ON assessment.hrms_assessment_schedules (tenant_id, blueprint_id);

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  schedule_id      uuid NOT NULL,
  blueprint_id     uuid NOT NULL,
  candidate_id     uuid NOT NULL,
  application_id   uuid,
  slot_label       varchar(64),
  status           varchar(20) NOT NULL DEFAULT 'assigned', -- assigned | in_progress | submitted | evaluated | expired | void
  identity_verified boolean NOT NULL DEFAULT false,          -- R-RA-0129
  identity_method  varchar(32),
  identity_meta    jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity_verified_at timestamptz,
  accommodation    jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {extraTimePct,notes} (R-RA-0127)
  question_order   jsonb NOT NULL DEFAULT '[]'::jsonb,       -- randomised [questionId] per candidate (R-RA-0124)
  started_at       timestamptz,
  deadline_at      timestamptz,
  submitted_at     timestamptz,
  last_saved_at    timestamptz,                              -- auto-save marker (R-RA-0130)
  total_score      numeric(8,2),
  max_score        numeric(8,2),
  section_scores   jsonb NOT NULL DEFAULT '{}'::jsonb,
  needs_manual_eval boolean NOT NULL DEFAULT false,
  result           varchar(16) NOT NULL DEFAULT 'pending',   -- pending | qualified | not_qualified | withheld
  evaluated_at     timestamptz,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  CONSTRAINT hrms_assessment_attempts_status_check
    CHECK (status IN ('assigned','in_progress','submitted','evaluated','expired','void')),
  CONSTRAINT hrms_assessment_attempts_result_check
    CHECK (result IN ('pending','qualified','not_qualified','withheld'))
);
-- One attempt per candidate per schedule.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_assessment_attempts_cand_uq
  ON assessment.hrms_assessment_attempts (tenant_id, schedule_id, candidate_id);

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_responses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  attempt_id   uuid NOT NULL,
  question_id  uuid NOT NULL,
  response     jsonb NOT NULL DEFAULT '{}'::jsonb,           -- {selected:[optId]} | {text} | {fileRef} | {passed,total}
  auto_score   numeric(8,2),
  is_correct   boolean,
  evaluated_at timestamptz,
  saved_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_assessment_responses_attempt_q_uq UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS hrms_assessment_responses_attempt_idx
  ON assessment.hrms_assessment_responses (tenant_id, attempt_id);

-- RLS (FORCE, app.tenant_id GUC).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_assessment_schedules','hrms_assessment_attempts','hrms_assessment_responses']
  LOOP
    EXECUTE format('ALTER TABLE assessment.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE assessment.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON assessment.%I', t||'_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON assessment.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t||'_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON assessment.%I TO hrms_svc', t);
  END LOOP;
END $$;
