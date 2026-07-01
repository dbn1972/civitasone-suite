-- 0027: Remove duplicate org hierarchy — use HRMS departments (cross-service).
-- estab_org_unit was incorrectly duplicating the hierarchy that already lives
-- in hrms-service (hrms_departments). estab-service now references HRMS
-- departments by UUID (cross-service id) instead of owning its own tree.
-- This is architecturally consistent with how estab already references HRMS
-- employees by UUID on estab_file_operator.employee_id.

-- (a) Rename the org_unit_id column on records officer to department_id.
ALTER TABLE files.estab_records_officer
  RENAME COLUMN org_unit_id TO department_id;
COMMENT ON COLUMN files.estab_records_officer.department_id IS
  'Cross-service reference to hrms_departments.id (HRMS service owns the hierarchy)';

-- (b) Drop the duplicate org-unit table and its indexes.
DROP INDEX IF EXISTS files.uq_org_unit_code;
DROP INDEX IF EXISTS files.idx_org_unit_parent;
DROP INDEX IF EXISTS files.idx_org_unit_type;
DROP TABLE IF EXISTS files.estab_org_unit;
