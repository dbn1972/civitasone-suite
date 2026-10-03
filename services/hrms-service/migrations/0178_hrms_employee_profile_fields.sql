-- 0178_hrms_employee_profile_fields.sql
--
-- GAP-HR-EMPLOYEES-NEW-01: the Add Employee wizard collects service grade,
-- marital status, blood group and shift, but createEmployeeBody had no such
-- keys, so zod stripped them and they never reached the record. They are now
-- real, nullable columns (NULL == not recorded; no back-fill, so no existing
-- row changes). Value sets are closed by CHECK constraints that mirror the zod
-- enums in employee/validators.ts. Cost centre needs no column: cost_center_id
-- already exists and the wizard now sends the picked id.
-- Additive + idempotent.

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS service_grade  varchar(64);
ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS marital_status varchar(16);
ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS blood_group    varchar(4);
ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS shift          varchar(16);

DO $$ BEGIN
  ALTER TABLE employee.hrms_employees ADD CONSTRAINT hrms_employees_marital_status_chk
    CHECK (marital_status IS NULL OR marital_status IN ('single','married','divorced','widowed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_employees ADD CONSTRAINT hrms_employees_blood_group_chk
    CHECK (blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','O+','O-','AB+','AB-'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE employee.hrms_employees ADD CONSTRAINT hrms_employees_shift_chk
    CHECK (shift IS NULL OR shift IN ('general','morning','evening','night'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
