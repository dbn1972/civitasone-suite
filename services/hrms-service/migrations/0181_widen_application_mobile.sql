-- Migration 0181: widen recruitment.hrms_applications.mobile
--
-- Same defect as 0131 (employee.hrms_employees.mobile): the column was created as VARCHAR(20), sized for a
-- plaintext phone number, but src/modules/recruitment/schema.ts declares it encryptedText("mobile") -- the PII-at-rest
-- wrapper whose ciphertext (IV + auth tag + base64) is far longer than 20 characters. Any application that carries a
-- mobile number (the public careers apply form, and HR-assisted entry) therefore fails the write with 22001
-- "value too long for type character varying(20)". Found while testing fin-recruitment-01's public apply with the new
-- optional fields: every apply that includes the (optional) mobile field returned 500.
--
-- Idempotent: ALTER COLUMN ... TYPE text is a no-op once the column is already text.
-- Rollback: not needed (text is a superset); narrowing back would truncate stored ciphertext.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE recruitment.hrms_applications
  ALTER COLUMN mobile TYPE text;

COMMIT;
