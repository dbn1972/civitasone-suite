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
