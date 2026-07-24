-- 0045_learning_competency.sql
-- SVC-121 (training administration: sessions/batches, nomination approval +
-- waitlist, attendance), SVC-122 (learning content & course catalogue),
-- SVC-124 (competency & skill management).
--
-- Additive + idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- RLS (FORCE + tenant_isolation policy) for every new table is applied in the
-- companion migration 0046_rls_learning_competency.sql, mirroring 0044.

-- ── SVC-121: training administration ─────────────────────────────────────────

-- Session / batch scheduling with capacity (belongs to a training programme).
CREATE TABLE IF NOT EXISTS training.hrms_training_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  training_id  uuid NOT NULL,
  title        text NOT NULL,
  session_date date NOT NULL,
  start_time   varchar(5),
  end_time     varchar(5),
  venue        text,
  capacity     integer NOT NULL DEFAULT 30,
  status       varchar(16) NOT NULL DEFAULT 'scheduled',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_training_sessions_training
  ON training.hrms_training_sessions (tenant_id, training_id);

-- Attendance capture per session (one row per employee per session).
CREATE TABLE IF NOT EXISTS training.hrms_session_attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  session_id   uuid NOT NULL,
  employee_id  uuid NOT NULL,
  status       varchar(12) NOT NULL DEFAULT 'present',
  marked_at    timestamptz NOT NULL DEFAULT now(),
  marked_by    uuid NOT NULL,
  UNIQUE (tenant_id, session_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_session_attendance_session
  ON training.hrms_session_attendance (tenant_id, session_id);

-- Nomination approval workflow (maker-checker) + waitlist + session assignment.
ALTER TABLE training.hrms_nominations
  ADD COLUMN IF NOT EXISTS nominated_by      uuid,
  ADD COLUMN IF NOT EXISTS approved_by       uuid,
  ADD COLUMN IF NOT EXISTS session_id        uuid,
  ADD COLUMN IF NOT EXISTS waitlist_position integer,
  ADD COLUMN IF NOT EXISTS decided_at        timestamptz;

-- Extend the nomination status domain for the approval workflow (adds
-- 'waitlisted' and 'rejected' to the existing check). Idempotent.
ALTER TABLE training.hrms_nominations DROP CONSTRAINT IF EXISTS hrms_nominations_status_check;
ALTER TABLE training.hrms_nominations ADD CONSTRAINT hrms_nominations_status_check
  CHECK (status IN ('nominated','approved','waitlisted','rejected','attended','completed','cancelled'));

-- Optional competency fed when a training is completed (SVC-121 → SVC-124).
ALTER TABLE training.hrms_trainings
  ADD COLUMN IF NOT EXISTS competency_ref text;

-- ── SVC-122: learning content & course catalogue ─────────────────────────────

CREATE SCHEMA IF NOT EXISTS learning;

CREATE TABLE IF NOT EXISTS learning.courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  code         varchar(32) NOT NULL,
  title        text NOT NULL,
  description  text,
  category     varchar(64) NOT NULL DEFAULT 'general',
  credit_hours numeric NOT NULL DEFAULT '0',
  status       varchar(16) NOT NULL DEFAULT 'draft',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS learning.course_prerequisites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  course_id            uuid NOT NULL,
  prerequisite_course_id uuid NOT NULL,
  UNIQUE (tenant_id, course_id, prerequisite_course_id)
);

CREATE TABLE IF NOT EXISTS learning.modules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  course_id  uuid NOT NULL,
  title      text NOT NULL,
  sequence   integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_modules_course
  ON learning.modules (tenant_id, course_id);

CREATE TABLE IF NOT EXISTS learning.lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  module_id     uuid NOT NULL,
  course_id     uuid NOT NULL,
  title         text NOT NULL,
  sequence      integer NOT NULL DEFAULT 1,
  content_type  varchar(12) NOT NULL DEFAULT 'link',
  content_uri   text,
  duration_mins integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_lessons_module
  ON learning.lessons (tenant_id, module_id);
CREATE INDEX IF NOT EXISTS idx_learning_lessons_course
  ON learning.lessons (tenant_id, course_id);

CREATE TABLE IF NOT EXISTS learning.enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  course_id       uuid NOT NULL,
  employee_id     uuid NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'enrolled',
  progress_pct    integer NOT NULL DEFAULT 0,
  resume_lesson_id uuid,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (tenant_id, course_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_learning_enrollments_emp
  ON learning.enrollments (tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS learning.lesson_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  lesson_id     uuid NOT NULL,
  status        varchar(12) NOT NULL DEFAULT 'completed',
  completed_at  timestamptz,
  UNIQUE (tenant_id, enrollment_id, lesson_id)
);

-- ── SVC-124: competency & skill management ───────────────────────────────────

CREATE SCHEMA IF NOT EXISTS competency;

CREATE TABLE IF NOT EXISTS competency.frameworks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        text NOT NULL,
  description text,
  status      varchar(16) NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS competency.competencies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  framework_id   uuid NOT NULL,
  code           varchar(48) NOT NULL,
  name           text NOT NULL,
  description    text,
  category       varchar(64) NOT NULL DEFAULT 'general',
  max_level      integer NOT NULL DEFAULT 5,
  certified_level integer NOT NULL DEFAULT 3,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS competency.role_requirements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  role_code      varchar(64) NOT NULL,
  competency_id  uuid NOT NULL,
  required_level integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role_code, competency_id)
);
CREATE INDEX IF NOT EXISTS idx_role_requirements_role
  ON competency.role_requirements (tenant_id, role_code);

CREATE TABLE IF NOT EXISTS competency.employee_competencies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  employee_id   uuid NOT NULL,
  competency_id uuid NOT NULL,
  current_level integer NOT NULL DEFAULT 0,
  source        varchar(16) NOT NULL DEFAULT 'manual',
  evidence_ref  text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, competency_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_competencies_emp
  ON competency.employee_competencies (tenant_id, employee_id);
