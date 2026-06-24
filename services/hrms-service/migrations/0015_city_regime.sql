-- P3: per-employee HRA city class (7th CPC X/Y/Z) and income-tax regime, so the
-- payroll run computes the correct HRA slab and TDS regime instead of defaults.
ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS hra_city_class varchar(1) NOT NULL DEFAULT 'X';
ALTER TABLE employee.hrms_employees
  DROP CONSTRAINT IF EXISTS chk_hrms_employees_hra_city_class;
ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT chk_hrms_employees_hra_city_class CHECK (hra_city_class IN ('X','Y','Z'));

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS tax_regime varchar(4) NOT NULL DEFAULT 'new';
ALTER TABLE employee.hrms_employees
  DROP CONSTRAINT IF EXISTS chk_hrms_employees_tax_regime;
ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT chk_hrms_employees_tax_regime CHECK (tax_regime IN ('old','new'));
