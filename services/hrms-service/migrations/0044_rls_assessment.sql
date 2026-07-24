-- 0044_rls_assessment.sql  (SVC-123 — Assessment & Certification RLS)
-- FORCE tenant isolation on all six assessment.* tables. Mirrors
-- 0026_rls_tenant_isolation.sql: a schema-local current_tenant_id() reading the
-- app.tenant_id GUC (fail-closed: `false` ⇒ error when the GUC is unset), then
-- ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy per table.
--
-- Idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS). FORCE applies the
-- policy even to the table owner, so the runtime NOBYPASSRLS role cannot read
-- across tenants regardless of an app-layer WHERE.

CREATE OR REPLACE FUNCTION assessment.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

ALTER TABLE assessment.question_banks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.assessments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.attempts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment.certificates    ENABLE ROW LEVEL SECURITY;

ALTER TABLE assessment.question_banks  FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.questions       FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.assessments     FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.attempts        FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.attempt_answers FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment.certificates    FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON assessment.question_banks;
DROP POLICY IF EXISTS tenant_isolation ON assessment.questions;
DROP POLICY IF EXISTS tenant_isolation ON assessment.assessments;
DROP POLICY IF EXISTS tenant_isolation ON assessment.attempts;
DROP POLICY IF EXISTS tenant_isolation ON assessment.attempt_answers;
DROP POLICY IF EXISTS tenant_isolation ON assessment.certificates;

CREATE POLICY tenant_isolation ON assessment.question_banks  USING (tenant_id = assessment.current_tenant_id());
CREATE POLICY tenant_isolation ON assessment.questions       USING (tenant_id = assessment.current_tenant_id());
CREATE POLICY tenant_isolation ON assessment.assessments     USING (tenant_id = assessment.current_tenant_id());
CREATE POLICY tenant_isolation ON assessment.attempts        USING (tenant_id = assessment.current_tenant_id());
CREATE POLICY tenant_isolation ON assessment.attempt_answers USING (tenant_id = assessment.current_tenant_id());
CREATE POLICY tenant_isolation ON assessment.certificates    USING (tenant_id = assessment.current_tenant_id());
