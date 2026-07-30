-- 0104_employee_matrix_managers_fitness.sql
-- Adds matrix management support (functional_manager_id, project_manager_id) and
-- fitness_status tracking to the employee table.
--
-- Rollback:
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS functional_manager_id;
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS project_manager_id;
--   ALTER TABLE employee.hrms_employees DROP COLUMN IF EXISTS fitness_status;

SET lock_timeout = '5s';

-- ── functional_manager_id ──────────────────────────────────────────────────
ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS functional_manager_id uuid;

COMMENT ON COLUMN employee.hrms_employees.functional_manager_id IS
  'UUID of the functional/dotted-line manager (matrix reporting)';

-- ── project_manager_id ─────────────────────────────────────────────────────
ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS project_manager_id uuid;

COMMENT ON COLUMN employee.hrms_employees.project_manager_id IS
  'UUID of the project manager (matrix reporting for project-based assignments)';

-- ── fitness_status ─────────────────────────────────────────────────────────
ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS fitness_status varchar(16) DEFAULT 'pending';

COMMENT ON COLUMN employee.hrms_employees.fitness_status IS
  'Medical/physical fitness status: pending, fit, unfit, restricted, exempt';

ALTER TABLE employee.hrms_employees
  DROP CONSTRAINT IF EXISTS hrms_employees_fitness_status_check;

ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT hrms_employees_fitness_status_check
  CHECK (fitness_status IN ('pending', 'fit', 'unfit', 'restricted', 'exempt'));

-- ── Indexes for manager lookups ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS hrms_employees_functional_mgr_idx
  ON employee.hrms_employees (tenant_id, functional_manager_id)
  WHERE functional_manager_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hrms_employees_project_mgr_idx
  ON employee.hrms_employees (tenant_id, project_manager_id)
  WHERE project_manager_id IS NOT NULL;
