-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: audit-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- compliance.audit_compliance_reports.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_compliance_reports_department_id
  ON compliance.audit_compliance_reports (department_id);

-- compliance.audit_pending_register.para_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_pending_register_para_id
  ON compliance.audit_pending_register (para_id);

-- observation.audit_observations.plan_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_observations_plan_id
  ON observation.audit_observations (plan_id);

-- observation.audit_working_papers.observation_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_working_papers_observation_id
  ON observation.audit_working_papers (observation_id);

-- para.audit_paras.observation_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_paras_observation_id
  ON para.audit_paras (observation_id);

-- para.audit_paras.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_paras_department_id
  ON para.audit_paras (department_id);

-- para.audit_dept_responses.para_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_dept_responses_para_id
  ON para.audit_dept_responses (para_id);

-- plan.audit_plan_items.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_plan_items_department_id
  ON plan.audit_plan_items (department_id);

-- plan.audit_teams.plan_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_teams_plan_id
  ON plan.audit_teams (plan_id);

-- risk.audit_plan_risks.plan_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_plan_risks_plan_id
  ON risk.audit_plan_risks (plan_id);

-- risk.audit_plan_risks.risk_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_plan_risks_risk_id
  ON risk.audit_plan_risks (risk_id);
