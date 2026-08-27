-- 0030_rls_completion_c3.sql
-- C3 RLS Completion: Enable row-level security on all remaining tables
-- that were introduced after the initial RLS migration (0026).
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE POLICY.

BEGIN;

-- ============================================================
-- Schema: employee
-- ============================================================

-- employee.hrms_loans (from 0014)
ALTER TABLE employee.hrms_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_loans;
CREATE POLICY tenant_isolation ON employee.hrms_loans USING (tenant_id = employee.current_tenant_id());

-- employee.hrms_salary_advances (from 0014)
ALTER TABLE employee.hrms_salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_salary_advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_salary_advances;
CREATE POLICY tenant_isolation ON employee.hrms_salary_advances USING (tenant_id = employee.current_tenant_id());

-- employee.hrms_fnf_settlements (from 0009)
ALTER TABLE employee.hrms_fnf_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_fnf_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_fnf_settlements;
CREATE POLICY tenant_isolation ON employee.hrms_fnf_settlements USING (tenant_id = employee.current_tenant_id());

-- employee.hrms_generated_letters (FIXED 2026-08-27: this file called it
-- "hrms_employee_letters", a table that has never existed anywhere in this
-- service; 0009_letters_shifts_fnf.sql's actual "documents" table from that
-- same section is employee.hrms_generated_letters — corrected to match.)
ALTER TABLE employee.hrms_generated_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_generated_letters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_generated_letters;
CREATE POLICY tenant_isolation ON employee.hrms_generated_letters USING (tenant_id = employee.current_tenant_id());

-- ============================================================
-- Schema: hrms
-- ============================================================

-- hrms.face_embeddings (from 0020_ai_ml_tables.sql)
ALTER TABLE hrms.face_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.face_embeddings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms.face_embeddings;
CREATE POLICY tenant_isolation ON hrms.face_embeddings USING (tenant_id = employee.current_tenant_id());

-- claims.hrms_travel_requests (FIXED 2026-08-27: was wrongly under schema "hrms."; from 0115_social_feed.sql)
ALTER TABLE claims.hrms_travel_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_travel_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_travel_requests;
CREATE POLICY tenant_isolation ON claims.hrms_travel_requests USING (tenant_id = employee.current_tenant_id());

-- claims.hrms_expense_claims (FIXED 2026-08-27: was wrongly under schema "hrms."; from 0115_social_feed.sql)
ALTER TABLE claims.hrms_expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_expense_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_expense_claims;
CREATE POLICY tenant_isolation ON claims.hrms_expense_claims USING (tenant_id = employee.current_tenant_id());

-- employee.hrms_push_devices (FIXED 2026-08-27: was wrongly under schema "hrms."; from 0115_social_feed.sql)
ALTER TABLE employee.hrms_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_push_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_push_devices;
CREATE POLICY tenant_isolation ON employee.hrms_push_devices USING (tenant_id = employee.current_tenant_id());

-- ============================================================
-- Schema: disciplinary
-- ============================================================

-- disciplinary.hrms_disciplinary_cases (from 0022)
ALTER TABLE disciplinary.hrms_disciplinary_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary.hrms_disciplinary_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON disciplinary.hrms_disciplinary_cases;
CREATE POLICY tenant_isolation ON disciplinary.hrms_disciplinary_cases USING (tenant_id = employee.current_tenant_id());

-- disciplinary.hrms_disciplinary_events (from 0022)
ALTER TABLE disciplinary.hrms_disciplinary_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary.hrms_disciplinary_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON disciplinary.hrms_disciplinary_events;
CREATE POLICY tenant_isolation ON disciplinary.hrms_disciplinary_events USING (tenant_id = employee.current_tenant_id());

-- disciplinary.hrms_suspensions (from 0022)
ALTER TABLE disciplinary.hrms_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary.hrms_suspensions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON disciplinary.hrms_suspensions;
CREATE POLICY tenant_isolation ON disciplinary.hrms_suspensions USING (tenant_id = employee.current_tenant_id());

-- ============================================================
-- Schema: claims
-- ============================================================

-- claims.hrms_ltc_claims (from 0020_deputation_ltc_cea.sql)
ALTER TABLE claims.hrms_ltc_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_ltc_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_ltc_claims;
CREATE POLICY tenant_isolation ON claims.hrms_ltc_claims USING (tenant_id = employee.current_tenant_id());

-- claims.hrms_cea_claims (from 0020_deputation_ltc_cea.sql)
ALTER TABLE claims.hrms_cea_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.hrms_cea_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON claims.hrms_cea_claims;
CREATE POLICY tenant_isolation ON claims.hrms_cea_claims USING (tenant_id = employee.current_tenant_id());

-- ============================================================
-- Schema: gpf
-- ============================================================

-- gpf.hrms_gpf_accounts (from 0018_gpf.sql)
ALTER TABLE gpf.hrms_gpf_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpf.hrms_gpf_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gpf.hrms_gpf_accounts;
CREATE POLICY tenant_isolation ON gpf.hrms_gpf_accounts USING (tenant_id = employee.current_tenant_id());

-- gpf.hrms_gpf_ledger (from 0018_gpf.sql)
ALTER TABLE gpf.hrms_gpf_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpf.hrms_gpf_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gpf.hrms_gpf_ledger;
CREATE POLICY tenant_isolation ON gpf.hrms_gpf_ledger USING (tenant_id = employee.current_tenant_id());

COMMIT;
