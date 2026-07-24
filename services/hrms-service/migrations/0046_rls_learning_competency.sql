-- 0046_rls_learning_competency.sql
-- FORCE tenant isolation for every table added in 0045. Mirrors
-- 0044_rls_assessment.sql / 0026_rls_tenant_isolation.sql: a schema-local
-- current_tenant_id() reading the app.tenant_id GUC (fail-closed: `false` ⇒
-- error when unset), then ENABLE + FORCE ROW LEVEL SECURITY and a
-- tenant_isolation policy per table. Idempotent.
--
-- The two new training.* tables need training.current_tenant_id() (the schema
-- did not previously define its own — the pre-existing training tables borrow
-- employee.current_tenant_id()). We add it here so the new tables are
-- self-contained; both functions read the SAME GUC so behaviour is identical.

CREATE OR REPLACE FUNCTION training.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT current_setting('app.tenant_id', false)::uuid $$;

CREATE OR REPLACE FUNCTION learning.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT current_setting('app.tenant_id', false)::uuid $$;

CREATE OR REPLACE FUNCTION competency.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT current_setting('app.tenant_id', false)::uuid $$;

-- ── training administration ──────────────────────────────────────────────────
ALTER TABLE training.hrms_training_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.hrms_session_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.hrms_training_sessions  FORCE ROW LEVEL SECURITY;
ALTER TABLE training.hrms_session_attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training.hrms_training_sessions;
DROP POLICY IF EXISTS tenant_isolation ON training.hrms_session_attendance;
CREATE POLICY tenant_isolation ON training.hrms_training_sessions  USING (tenant_id = training.current_tenant_id());
CREATE POLICY tenant_isolation ON training.hrms_session_attendance USING (tenant_id = training.current_tenant_id());

-- ── learning catalogue ───────────────────────────────────────────────────────
ALTER TABLE learning.courses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.course_prerequisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.modules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.lessons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.enrollments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.lesson_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.courses              FORCE ROW LEVEL SECURITY;
ALTER TABLE learning.course_prerequisites FORCE ROW LEVEL SECURITY;
ALTER TABLE learning.modules              FORCE ROW LEVEL SECURITY;
ALTER TABLE learning.lessons              FORCE ROW LEVEL SECURITY;
ALTER TABLE learning.enrollments          FORCE ROW LEVEL SECURITY;
ALTER TABLE learning.lesson_progress      FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON learning.courses;
DROP POLICY IF EXISTS tenant_isolation ON learning.course_prerequisites;
DROP POLICY IF EXISTS tenant_isolation ON learning.modules;
DROP POLICY IF EXISTS tenant_isolation ON learning.lessons;
DROP POLICY IF EXISTS tenant_isolation ON learning.enrollments;
DROP POLICY IF EXISTS tenant_isolation ON learning.lesson_progress;
CREATE POLICY tenant_isolation ON learning.courses              USING (tenant_id = learning.current_tenant_id());
CREATE POLICY tenant_isolation ON learning.course_prerequisites USING (tenant_id = learning.current_tenant_id());
CREATE POLICY tenant_isolation ON learning.modules              USING (tenant_id = learning.current_tenant_id());
CREATE POLICY tenant_isolation ON learning.lessons              USING (tenant_id = learning.current_tenant_id());
CREATE POLICY tenant_isolation ON learning.enrollments          USING (tenant_id = learning.current_tenant_id());
CREATE POLICY tenant_isolation ON learning.lesson_progress      USING (tenant_id = learning.current_tenant_id());

-- ── competency ───────────────────────────────────────────────────────────────
ALTER TABLE competency.frameworks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency.competencies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency.role_requirements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency.employee_competencies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency.frameworks             FORCE ROW LEVEL SECURITY;
ALTER TABLE competency.competencies           FORCE ROW LEVEL SECURITY;
ALTER TABLE competency.role_requirements      FORCE ROW LEVEL SECURITY;
ALTER TABLE competency.employee_competencies  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON competency.frameworks;
DROP POLICY IF EXISTS tenant_isolation ON competency.competencies;
DROP POLICY IF EXISTS tenant_isolation ON competency.role_requirements;
DROP POLICY IF EXISTS tenant_isolation ON competency.employee_competencies;
CREATE POLICY tenant_isolation ON competency.frameworks             USING (tenant_id = competency.current_tenant_id());
CREATE POLICY tenant_isolation ON competency.competencies           USING (tenant_id = competency.current_tenant_id());
CREATE POLICY tenant_isolation ON competency.role_requirements      USING (tenant_id = competency.current_tenant_id());
CREATE POLICY tenant_isolation ON competency.employee_competencies  USING (tenant_id = competency.current_tenant_id());
