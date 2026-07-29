-- 0081_assessment_blueprint.sql
-- Assessment management — design-time foundation (checklist R-RA-0120/0121/0123/0125).
--   • hrms_assessment_blueprints — the assessment definition by role/competency/
--     difficulty/duration with a versioned, effective-dated, activate/deactivate
--     scoring configuration (negative marking, section cut-offs, total cut-off,
--     tie-break). Invalid scoring combinations are blocked at activation.
--   • hrms_assessment_questions — a validated question bank carrying version,
--     answer key, difficulty, topic, type (MCQ / descriptive / case study /
--     coding / file upload / psychometric) and usage count.
--   • hrms_assessment_events — the immutable security-audit trail for blueprint
--     and question lifecycle actions (create / activate / deactivate / validate /
--     retire), satisfying the segregation-of-duties + audit AC.
-- New `assessment` schema. FORCE RLS (app.tenant_id GUC). Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS assessment.hrms_assessment_events,
--           assessment.hrms_assessment_questions, assessment.hrms_assessment_blueprints;
--           DROP SCHEMA IF EXISTS assessment;

CREATE SCHEMA IF NOT EXISTS assessment;

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_blueprints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  code             varchar(64)  NOT NULL,                 -- tenant-unique reference
  title            varchar(256) NOT NULL,
  role_title       varchar(200),
  designation_id   uuid,
  competencies     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{key,title,weightBps}]
  allowed_types    jsonb NOT NULL DEFAULT '[]'::jsonb,    -- ["mcq","descriptive",...] (R-RA-0123)
  duration_minutes integer NOT NULL,
  scoring_config   jsonb NOT NULL DEFAULT '{}'::jsonb,    -- sections, cut-offs, negative marking, tie-break (R-RA-0125)
  status           varchar(16) NOT NULL DEFAULT 'draft',  -- draft | active | inactive
  version          integer NOT NULL DEFAULT 1,
  effective_from   timestamptz,
  activated_by     uuid,
  activated_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  CONSTRAINT hrms_assessment_blueprints_status_check
    CHECK (status IN ('draft','active','inactive')),
  CONSTRAINT hrms_assessment_blueprints_duration_check
    CHECK (duration_minutes > 0)
);
-- One blueprint per (tenant, code) — the code is the stable business reference.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_assessment_blueprints_code_uq
  ON assessment.hrms_assessment_blueprints (tenant_id, code);

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  topic           varchar(120) NOT NULL,                  -- topic / competency (R-RA-0121)
  qtype           varchar(24)  NOT NULL,                  -- mcq | descriptive | case_study | coding | file_upload | psychometric
  stem            text NOT NULL,                          -- the question text
  options         jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{id,text}] for objective types
  answer_key      jsonb NOT NULL DEFAULT '{}'::jsonb,     -- {correct:[id]} | {rubricRef} | {testCasesRef} | {scoringKeyRef}
  difficulty      varchar(12)  NOT NULL,                  -- easy | medium | hard
  marks           integer NOT NULL,
  status          varchar(12)  NOT NULL DEFAULT 'draft',  -- draft | validated | retired
  usage_count     integer NOT NULL DEFAULT 0,             -- usage history counter (R-RA-0121)
  last_used_at    timestamptz,
  version         integer NOT NULL DEFAULT 1,
  validated_by    uuid,
  validated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  CONSTRAINT hrms_assessment_questions_qtype_check
    CHECK (qtype IN ('mcq','descriptive','case_study','coding','file_upload','psychometric')),
  CONSTRAINT hrms_assessment_questions_difficulty_check
    CHECK (difficulty IN ('easy','medium','hard')),
  CONSTRAINT hrms_assessment_questions_status_check
    CHECK (status IN ('draft','validated','retired')),
  CONSTRAINT hrms_assessment_questions_marks_check
    CHECK (marks > 0)
);
CREATE INDEX IF NOT EXISTS hrms_assessment_questions_topic_idx
  ON assessment.hrms_assessment_questions (tenant_id, topic);
CREATE INDEX IF NOT EXISTS hrms_assessment_questions_bank_idx
  ON assessment.hrms_assessment_questions (tenant_id, qtype, difficulty, status);

CREATE TABLE IF NOT EXISTS assessment.hrms_assessment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_type   varchar(16) NOT NULL,                     -- blueprint | question
  entity_id     uuid NOT NULL,
  action        varchar(24) NOT NULL,                     -- create | update | activate | deactivate | validate | retire
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_assessment_events_entity_check
    CHECK (entity_type IN ('blueprint','question')),
  CONSTRAINT hrms_assessment_events_action_check
    CHECK (action IN ('create','update','activate','deactivate','validate','retire'))
);
CREATE INDEX IF NOT EXISTS hrms_assessment_events_entity_idx
  ON assessment.hrms_assessment_events (tenant_id, entity_type, entity_id, created_at);

-- RLS (FORCE, app.tenant_id GUC) for all three tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_assessment_blueprints','hrms_assessment_questions','hrms_assessment_events']
  LOOP
    EXECUTE format('ALTER TABLE assessment.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE assessment.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON assessment.%I', t||'_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON assessment.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t||'_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON assessment.%I TO hrms_svc', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA assessment TO hrms_svc;
