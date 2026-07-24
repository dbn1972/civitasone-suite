-- 0043_assessment_certification.sql  (SVC-123 — Assessment & Certification)
-- New `assessment` schema: question banks, questions, assessments, attempts,
-- attempt answers and certificates. Additive + idempotent (IF NOT EXISTS).
-- Money/marks as numeric. RLS is added in 0044_rls_assessment.sql.
--
-- Rollback: DROP SCHEMA IF EXISTS assessment CASCADE;

CREATE SCHEMA IF NOT EXISTS assessment;

CREATE TABLE IF NOT EXISTS assessment.question_banks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  title          text NOT NULL,
  competency_ref text,
  status         varchar(24) NOT NULL DEFAULT 'active',
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_banks_status_check CHECK (status IN ('active','archived'))
);

CREATE TABLE IF NOT EXISTS assessment.questions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  bank_id   uuid NOT NULL REFERENCES assessment.question_banks(id) ON DELETE CASCADE,
  qtype     varchar(16) NOT NULL,
  stem      text NOT NULL,
  options   jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct   jsonb NOT NULL DEFAULT '[]'::jsonb,
  marks     numeric NOT NULL DEFAULT 1,
  active    boolean NOT NULL DEFAULT true,
  CONSTRAINT questions_qtype_check CHECK (qtype IN ('single','multi','truefalse')),
  CONSTRAINT questions_marks_positive CHECK (marks > 0)
);

CREATE TABLE IF NOT EXISTS assessment.assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  title           text NOT NULL,
  course_ref      text,
  bank_id         uuid NOT NULL REFERENCES assessment.question_banks(id),
  passing_score   numeric NOT NULL,
  duration_mins   integer NOT NULL DEFAULT 30,
  max_attempts    integer NOT NULL DEFAULT 1,
  validity_months integer,
  status          varchar(24) NOT NULL DEFAULT 'draft',
  created_by      uuid NOT NULL,
  approved_by     uuid,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessments_status_check CHECK (status IN ('draft','pending_approval','published','retired')),
  CONSTRAINT assessments_passing_score_nonneg CHECK (passing_score >= 0),
  CONSTRAINT assessments_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE TABLE IF NOT EXISTS assessment.attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  assessment_id uuid NOT NULL REFERENCES assessment.assessments(id),
  employee_id   uuid NOT NULL,
  attempt_no    integer NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'in_progress',
  started_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  score         numeric,
  passed        boolean,
  CONSTRAINT attempts_status_check CHECK (status IN ('in_progress','submitted','graded'))
);

CREATE TABLE IF NOT EXISTS assessment.attempt_answers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  attempt_id    uuid NOT NULL REFERENCES assessment.attempts(id) ON DELETE CASCADE,
  question_id   uuid NOT NULL REFERENCES assessment.questions(id),
  response      jsonb NOT NULL DEFAULT '[]'::jsonb,
  awarded_marks numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assessment.certificates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  assessment_id  uuid NOT NULL REFERENCES assessment.assessments(id),
  attempt_id     uuid NOT NULL UNIQUE REFERENCES assessment.attempts(id),
  employee_id    uuid NOT NULL,
  certificate_no text NOT NULL UNIQUE,
  verify_token   text NOT NULL UNIQUE,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  status         varchar(16) NOT NULL DEFAULT 'active',
  CONSTRAINT certificates_status_check CHECK (status IN ('active','expired','revoked'))
);

-- Indexes (tenant-leading, mirrors the service convention)
CREATE INDEX IF NOT EXISTS question_banks_tenant_idx   ON assessment.question_banks (tenant_id);
CREATE INDEX IF NOT EXISTS questions_bank_idx          ON assessment.questions (tenant_id, bank_id);
CREATE INDEX IF NOT EXISTS assessments_tenant_idx      ON assessment.assessments (tenant_id, status);
CREATE INDEX IF NOT EXISTS assessments_bank_idx        ON assessment.assessments (tenant_id, bank_id);
CREATE INDEX IF NOT EXISTS attempts_assessment_emp_idx ON assessment.attempts (tenant_id, assessment_id, employee_id);
CREATE INDEX IF NOT EXISTS attempt_answers_attempt_idx ON assessment.attempt_answers (tenant_id, attempt_id);
CREATE INDEX IF NOT EXISTS certificates_tenant_emp_idx ON assessment.certificates (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS certificates_token_idx      ON assessment.certificates (verify_token);

-- Privileges: the runtime role (hrms_svc, NOBYPASSRLS) must be able to use the
-- new schema + its tables. New schemas do not inherit ALTER DEFAULT PRIVILEGES
-- granted for the pre-existing schemas, so grant explicitly here.
GRANT USAGE ON SCHEMA assessment TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA assessment TO hrms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA assessment
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_svc;
