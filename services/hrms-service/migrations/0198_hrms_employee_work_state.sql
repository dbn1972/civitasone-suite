-- 0198_hrms_employee_work_state.sql
--
-- Professional tax is levied per STATE OF EMPLOYMENT. HRMS had no usable field
-- for it: hrms_employees.location_id points at location-service, whose
-- locations carry no ISO state / UT code (only a free-text lgd_code), and the
-- employee address `state` is free text for the RESIDENCE, not the workplace.
-- So the smallest correct source is an explicit, optional column: the ISO
-- 3166-2:IN state / UT code (the codes payroll-service accepts, e.g. MH, KA)
-- of the state the employee works in. NULL = not recorded (no back-fill, no
-- guess). Fed to payroll as `stateCode` on the payroll-input feed.
-- Additive + idempotent. Rollback: ALTER TABLE employee.hrms_employees DROP COLUMN work_state_code;

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS work_state_code varchar(4);
