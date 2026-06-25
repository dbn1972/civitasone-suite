-- P1-5: lock the employee status contract to one canonical lowercase enum.
-- Additive + idempotent. Normalises any mixed-case/legacy values, then enforces
-- the contract at the data layer so the read models/UI never normalise casing.
UPDATE employee.hrms_employees SET status = lower(status) WHERE status <> lower(status);
-- legacy synthetic "active" -> the real serving status "confirmed"
UPDATE employee.hrms_employees SET status = 'confirmed' WHERE status = 'active';
ALTER TABLE employee.hrms_employees DROP CONSTRAINT IF EXISTS hrms_employees_status_check;
ALTER TABLE employee.hrms_employees ADD CONSTRAINT hrms_employees_status_check
  CHECK (status IN ('probation','confirmed','on_leave','suspended','deputation','retired','separated','terminated'));
