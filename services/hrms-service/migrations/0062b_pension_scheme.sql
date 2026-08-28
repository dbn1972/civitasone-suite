-- P3: pension scheme on employees (GPF/NPS/EPF for eHRMS compliance)
-- Renumbered 2026-08-27: originally 0113_pension_scheme.sql. Its ADD COLUMN
-- is the only source of employee.hrms_employees.pension_scheme, but
-- 0063_nps_cpf.sql already CHECK-constrains that column (widening it to
-- add 'CPF'), so 0063 failed with "column pension_scheme does not exist" on
-- a fresh cluster. Moved to the smallest slot sorting before that earliest
-- consumer. Content unchanged.

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS pension_scheme varchar(8) NOT NULL DEFAULT 'NPS';

ALTER TABLE employee.hrms_employees
  DROP CONSTRAINT IF EXISTS chk_hrms_employees_pension_scheme;

ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT chk_hrms_employees_pension_scheme
  CHECK (pension_scheme IN ('GPF', 'NPS', 'EPF'));

-- Demo: pre-2004 joiners on GPF, post-2004 on NPS
UPDATE employee.hrms_employees
SET pension_scheme = 'GPF'
WHERE date_of_joining < '2004-01-01' AND pension_scheme = 'NPS';
