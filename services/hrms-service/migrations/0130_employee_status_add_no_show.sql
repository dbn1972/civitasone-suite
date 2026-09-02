-- Fix: "no_show" was never added to the employee status contract.
--
-- agent1-gap-routes.ts (POST /v1/hrms/employees/:id/reverse-no-show) and its
-- f3-consumer.ts consumer (case employee_agent1_gap_routes__2) both gate on
-- employee.hrms_employees.status = 'no_show' as the precondition for the
-- reversal workflow, but 0025_employee_status_contract.sql's
-- hrms_employees_status_check never included 'no_show' in its allowed list —
-- and 0035_check_constraints_status_columns.sql's later attempt to add a
-- same-named constraint with a different vocabulary was a silent no-op
-- (ADD CONSTRAINT hit duplicate_object against 0025's constraint and was
-- swallowed by its own exception handler). So the only constraint actually in
-- effect is 0025's, which has never allowed 'no_show' — any write of
-- status = 'no_show' would violate the CHECK and roll back, making the
-- precondition the reversal endpoint checks for permanently unreachable.
--
-- Additive + idempotent, matching the DROP/re-ADD pattern 0025 itself used.
ALTER TABLE employee.hrms_employees DROP CONSTRAINT IF EXISTS hrms_employees_status_check;
ALTER TABLE employee.hrms_employees ADD CONSTRAINT hrms_employees_status_check
  CHECK (status IN ('probation','confirmed','on_leave','suspended','deputation','retired','separated','terminated','no_show'));
