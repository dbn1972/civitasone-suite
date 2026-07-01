-- 0012: Add department_id UUID to audit_paras, audit_plan_items, audit_compliance_reports.
-- Cross-service typed reference to hrms_departments.id (authoritative org hierarchy).
-- The existing text fields (dept_ref) stay for display/search.
-- Additive, idempotent, forward-only.

-- audit_paras (para schema)
ALTER TABLE para.audit_paras
  ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN para.audit_paras.department_id IS
  'Optional cross-service reference to hrms_departments.id';

CREATE INDEX IF NOT EXISTS idx_audit_paras_dept_id
  ON para.audit_paras (tenant_id, department_id);

-- audit_plan_items (plan schema) — holds deptRef
ALTER TABLE plan.audit_plan_items
  ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN plan.audit_plan_items.department_id IS
  'Optional cross-service reference to hrms_departments.id';

CREATE INDEX IF NOT EXISTS idx_audit_plan_items_dept_id
  ON plan.audit_plan_items (tenant_id, department_id);

-- audit_compliance_reports (compliance schema)
ALTER TABLE compliance.audit_compliance_reports
  ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN compliance.audit_compliance_reports.department_id IS
  'Optional cross-service reference to hrms_departments.id';

CREATE INDEX IF NOT EXISTS idx_audit_compliance_dept_id
  ON compliance.audit_compliance_reports (tenant_id, department_id);
