-- 0009: Add department_id UUID to legal_hearings.
-- Cross-service typed reference to hrms_departments.id (authoritative org hierarchy).
-- Additive, idempotent, forward-only.

ALTER TABLE hearings.legal_hearings
  ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN hearings.legal_hearings.department_id IS
  'Optional cross-service reference to hrms_departments.id';

CREATE INDEX IF NOT EXISTS idx_legal_hearings_dept_id
  ON hearings.legal_hearings (tenant_id, department_id);
