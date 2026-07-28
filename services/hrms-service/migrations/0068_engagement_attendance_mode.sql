-- hrms-service migration 0068 — engagement-type attendance applicability.
--
-- Adds attendance_mode to the engagement policy so the payroll-input feed knows
-- whether a type's muster absence drives SALARY Loss-of-Pay:
--   muster_lop    — attendance / approved-LOP leave docks salary
--                   (pay_scale, contractual — DIC employees on a muster)
--   informational — attendance tracked for compliance / agency billing but
--                   never docks a DIC salary (third_party agency-paid;
--                   apprentice on a NAPS stipend, not payroll)
--   none          — attendance not applicable (consultant, invoice-billed)
--
-- Default 'muster_lop' keeps every pre-existing type behaving exactly as before
-- (a salaried employee on a muster), so this is a safe, additive change.
-- Idempotent.

ALTER TABLE employee.engagement_type_catalogue
  ADD COLUMN IF NOT EXISTS attendance_mode varchar(16) NOT NULL DEFAULT 'muster_lop';
ALTER TABLE employee.hrms_employee_types
  ADD COLUMN IF NOT EXISTS attendance_mode varchar(16) NOT NULL DEFAULT 'muster_lop';

-- Canonical DIC engagement categories (pay_scale + contractual keep the default).
UPDATE employee.engagement_type_catalogue SET attendance_mode = 'none'          WHERE category = 'consultant';
UPDATE employee.engagement_type_catalogue SET attendance_mode = 'informational' WHERE category = 'third_party';
UPDATE employee.engagement_type_catalogue SET attendance_mode = 'informational' WHERE category = 'apprentice';
