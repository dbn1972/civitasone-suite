-- hrms-service migration 0066 — make engagement back-fill safe to trust.
--
-- Migration 0065 added statutory/terminal columns to employee.hrms_employee_types
-- with defaults that are correct for a *fresh* row but WRONG as a back-fill on
-- pre-existing type rows: statutory_nps DEFAULT false and leave_encashment
-- DEFAULT false would, once the resolver trusts un-categorised rows, suppress
-- NPS / leave-encashment for employees on legacy types (permanent, contract, …).
--
-- The resolver now (post code-review fix) TRUSTS an un-categorised ('other')
-- tenant type row's own flags so admins can configure custom types without
-- assigning a canonical category. For that to be safe, the pre-existing
-- back-filled 'other' rows — which no admin has intentionally configured yet —
-- must be permissive. Categorised rows are unaffected (their policy comes from
-- the canonical catalogue, not these columns).
--
-- Idempotent. No tenant *data* rows are touched — only the type-master config.

-- 1. Reset the two unsafe back-filled flags to permissive on un-categorised
--    ('other') type rows. Categorised rows keep whatever they have (canonical
--    drives their policy anyway).
UPDATE employee.hrms_employee_types
   SET statutory_nps = true,
       leave_encashment = true
 WHERE category = 'other';

-- 2. Make the column defaults permissive so future un-categorised custom types
--    default to full benefits (an admin sets the restrictive flags they want).
ALTER TABLE employee.hrms_employee_types
  ALTER COLUMN statutory_nps    SET DEFAULT true,
  ALTER COLUMN leave_encashment SET DEFAULT true;
