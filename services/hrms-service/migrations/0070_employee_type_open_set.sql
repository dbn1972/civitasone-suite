-- 0070_employee_type_open_set.sql
-- Open the employee_type domain to the engagement-type framework.
--
-- The engagement-type framework (PR #228) accepts the canonical DIC engagement
-- categories (pay_scale / contractual / consultant / third_party / apprentice)
-- AND tenant-defined type-master codes, with validity enforced at the
-- application layer (assertKnownEngagementType) against the engagement catalogue
-- + tenant master + legacy defaults.
--
-- But the original hard-coded CHECK enumerated only 7 legacy codes
-- (permanent/temporary/contract/deputation/intern/apprentice/volunteer), so the
-- DB REJECTED consultant / pay_scale / contractual / third_party and EVERY
-- tenant-defined code at insert time — silently blocking the whole framework
-- end-to-end (only 'apprentice', present in both sets, worked).
--
-- An enumerated CHECK is fundamentally incompatible with an open set of
-- tenant-defined types, so replace it with a bounded sanity check (non-empty,
-- length <= 32, matching the validator bound). Validity of the *value* is the
-- application layer's job. Idempotent.

ALTER TABLE employee.hrms_employees
  DROP CONSTRAINT IF EXISTS hrms_employees_employee_type_check;
ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT hrms_employees_employee_type_check
  CHECK (employee_type IS NULL OR char_length(employee_type) BETWEEN 1 AND 32);
