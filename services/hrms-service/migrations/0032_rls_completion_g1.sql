-- 0032_rls_completion_g1.sql
-- G1 RLS Completion: Enable row-level security on remaining tables
-- that were missed from 0026 + 0030 (pension.*, hrms.face_verification_log,
-- recruitment.hrms_interviews).
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE POLICY.
-- Uses the current_tenant_id() NULL-returning pattern established in 0026.

BEGIN;

-- ============================================================
-- Schema: pension (from 0016_pension.sql)
-- ============================================================

ALTER TABLE pension.hrms_pension_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pension.hrms_pension_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pension.hrms_pension_records;
CREATE POLICY tenant_isolation ON pension.hrms_pension_records
  USING (tenant_id = employee.current_tenant_id());

-- ============================================================
-- Schema: hrms (face_verification_log from 0020_ai_ml_tables.sql)
-- ============================================================

ALTER TABLE hrms.face_verification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.face_verification_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms.face_verification_log;
CREATE POLICY tenant_isolation ON hrms.face_verification_log
  USING (tenant_id = employee.current_tenant_id());

-- ============================================================
-- Schema: recruitment (hrms_interviews from 0008_recruitment_payroll_gaps.sql)
-- ============================================================

ALTER TABLE recruitment.hrms_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_interviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_interviews;
CREATE POLICY tenant_isolation ON recruitment.hrms_interviews
  USING (tenant_id = employee.current_tenant_id());

COMMIT;
