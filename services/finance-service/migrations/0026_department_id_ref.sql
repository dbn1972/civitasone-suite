-- 0026: Add department_id UUID to finance_audit_paras.
-- Cross-service typed reference to hrms_departments.id (authoritative org hierarchy).
-- The existing text field (dept) stays for display/search.
-- Additive, idempotent, forward-only.

ALTER TABLE audit.finance_audit_paras
  ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN audit.finance_audit_paras.department_id IS
  'Optional cross-service reference to hrms_departments.id';

CREATE INDEX IF NOT EXISTS idx_finance_audit_paras_dept_id
  ON audit.finance_audit_paras (tenant_id, department_id);
