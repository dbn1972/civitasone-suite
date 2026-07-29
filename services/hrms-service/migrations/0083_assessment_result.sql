-- 0083_assessment_result.sql
-- Assessment management — result finalisation (checklist R-RA-0132/0133/0134).
--   • hrms_assessment_evaluations — anonymised manual/descriptive evaluator scores
--     per (attempt, question, evaluator); resolves the "withheld" objective-only
--     result once every manual question is scored (R-RA-0132).
--   • hrms_assessment_attempts gains moderation (normalisation / scaling) with a
--     preserved raw score, and an authorised freeze -> publish gate (R-RA-0133/0134).
--   • hrms_assessment_result_events — immutable audit of consolidate / moderate /
--     freeze / publish actions (maker-checker + authorised-freeze evidence).
-- Extends the `assessment` schema. FORCE RLS. Additive + idempotent.
--
-- Rollback: DROP TABLE assessment.hrms_assessment_result_events, assessment.hrms_assessment_evaluations;
--           ALTER TABLE assessment.hrms_assessment_attempts DROP COLUMN raw_total_score, ... ;

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_evaluations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  attempt_id    uuid NOT NULL,
  question_id   uuid NOT NULL,
  evaluator_id  uuid NOT NULL,
  score         numeric(8,2) NOT NULL,
  max_marks     integer NOT NULL,
  remarks       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_assessment_evaluations_score_check CHECK (score >= 0 AND score <= max_marks),
  CONSTRAINT hrms_assessment_evaluations_uq UNIQUE (attempt_id, question_id, evaluator_id)
);
CREATE INDEX IF NOT EXISTS hrms_assessment_evaluations_attempt_idx
  ON assessment.hrms_assessment_evaluations (tenant_id, attempt_id);

ALTER TABLE assessment.hrms_assessment_attempts
  ADD COLUMN IF NOT EXISTS raw_total_score numeric(8,2),                 -- total before moderation
  ADD COLUMN IF NOT EXISTS moderation      jsonb NOT NULL DEFAULT '{}'::jsonb, -- {method,factor,notes,proposedBy,approvedBy}
  ADD COLUMN IF NOT EXISTS moderated_by    uuid,
  ADD COLUMN IF NOT EXISTS moderated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS frozen          boolean NOT NULL DEFAULT false, -- R-RA-0134
  ADD COLUMN IF NOT EXISTS frozen_by       uuid,
  ADD COLUMN IF NOT EXISTS frozen_at       timestamptz,
  ADD COLUMN IF NOT EXISTS published       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at    timestamptz;

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_result_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  attempt_id  uuid NOT NULL,
  action      varchar(24) NOT NULL,   -- evaluate | consolidate | moderate_propose | moderate_approve | moderation_reset | freeze | publish
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id    uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_assessment_result_events_action_check
    CHECK (action IN ('evaluate','consolidate','moderate_propose','moderate_approve','moderation_reset','freeze','publish'))
);
CREATE INDEX IF NOT EXISTS hrms_assessment_result_events_attempt_idx
  ON assessment.hrms_assessment_result_events (tenant_id, attempt_id, created_at);

-- RLS (FORCE, app.tenant_id GUC) on the two new tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_assessment_evaluations','hrms_assessment_result_events']
  LOOP
    EXECUTE format('ALTER TABLE assessment.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE assessment.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON assessment.%I', t||'_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON assessment.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t||'_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON assessment.%I TO hrms_svc', t);
  END LOOP;
END $$;
