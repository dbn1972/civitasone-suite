-- P3: pension scheme on employees (GPF/NPS/EPF for eHRMS compliance)

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
