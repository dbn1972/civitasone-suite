-- P3: ensure UAN (Universal Account Number) column exists for EPFO ECR filing.
-- The column predates the Drizzle model (schema drift); this makes it explicit
-- and idempotent so the ECR generator can project it.
ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS uan_number varchar(12);
