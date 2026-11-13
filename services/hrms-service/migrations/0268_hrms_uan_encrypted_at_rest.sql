-- 0268_hrms_uan_encrypted_at_rest.sql
--
-- Section 8 G6 (owner decision 5, 10 Nov 2026): the UAN is encrypted at rest like pan / bank_account_no.
-- Until now employee.hrms_employees.uan_number was a plaintext varchar(12) (read-only check 10 Nov: 424 rows, 0 sealed),
-- while pan and bank_account_no were already "enc:v2:" envelopes. The application column type is now `encryptedText`
-- (src/shared/pii-crypto.ts), whose ciphertext is longer than 12 characters, so the column is widened to text.
--
-- Additive and idempotent: widening varchar(12) -> text rewrites no data and is a no-op when already text.
-- Existing plaintext rows keep reading (decryptPii passes through any value without an "enc:" prefix) and are sealed
-- the next time the row is written; a backfill of the 424 existing rows is a separate, post-sign-off step.
-- No view depends on the column (checked pg_depend/pg_rewrite).
--
-- Rollback (only while no row holds ciphertext, i.e. before any sealed write):
--   ALTER TABLE employee.hrms_employees ALTER COLUMN uan_number TYPE varchar(12);

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees ALTER COLUMN uan_number TYPE text;

-- The UAN a maker supplies with an EPF pension-scheme request is held (pending) until approval: same treatment.
-- Rollback (only while no row holds ciphertext): ALTER TABLE employee.hrms_pension_scheme_changes ALTER COLUMN uan_number TYPE varchar(12);
ALTER TABLE employee.hrms_pension_scheme_changes ALTER COLUMN uan_number TYPE text;

-- The 0261 CHECK required 12 bare digits; ciphertext cannot satisfy it. Plaintext (legacy rows) or an "enc:" envelope is accepted;
-- the 12-digit format of NEW values is validated by the API (pension-scheme-commands.ts) before encryption.
ALTER TABLE employee.hrms_pension_scheme_changes DROP CONSTRAINT IF EXISTS hrms_pension_scheme_changes_uan_check;
ALTER TABLE employee.hrms_pension_scheme_changes ADD CONSTRAINT hrms_pension_scheme_changes_uan_check
  CHECK (uan_number IS NULL OR uan_number ~ '^[0-9]{12}$' OR uan_number ~ '^enc:v[12]:');
