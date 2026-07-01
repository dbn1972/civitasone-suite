-- 0028: Add department_id UUID to estab_files and estab_file_operator.
-- Cross-service typed reference to hrms_departments.id (authoritative org hierarchy).
-- The existing text fields (dept, division) stay for display/search.
-- Additive, idempotent, forward-only.

ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN files.estab_files.department_id IS
  'Optional cross-service reference to hrms_departments.id';

CREATE INDEX IF NOT EXISTS idx_estab_files_dept_id
  ON files.estab_files (tenant_id, department_id);

ALTER TABLE files.estab_file_operator
  ADD COLUMN IF NOT EXISTS department_id UUID;

COMMENT ON COLUMN files.estab_file_operator.department_id IS
  'Optional cross-service reference to hrms_departments.id (typed ref alongside text division)';

CREATE INDEX IF NOT EXISTS idx_estab_file_operator_dept_id
  ON files.estab_file_operator (tenant_id, department_id);
