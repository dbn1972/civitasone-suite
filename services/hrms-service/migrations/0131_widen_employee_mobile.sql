-- Migration 0131: widen employee.hrms_employees.mobile
--
-- Root cause: migration 0001_init.sql declared mobile as VARCHAR(20), sized
-- for a plaintext phone number. src/modules/employee/schema.ts declares
-- mobile as encryptedText("mobile") — the same PII-at-rest wrapper used for
-- pan, aadhaar_ref, email, bank_account_no and bank_ifsc on this same
-- table, all five of which are `text` (unbounded), not varchar-limited.
-- mobile is the only encrypted column on this table still sized for its
-- plaintext value: any POST /v1/hrms/employees with a mobile number fails
-- the CQRS write at the database layer with 22001 "value too long for type
-- character varying(20)", because the ciphertext (IV + auth tag + base64
-- overhead) is far longer than the ~15-char plaintext it replaces. Same
-- shape of bug as 0127 (attendance.hrms_geo_attendance.check_type sized for
-- one enum value, not the other) — a column sized for the wrong thing that
-- was written to it.
--
-- Idempotent: safe to re-run — ALTER COLUMN ... TYPE text is a no-op once
-- the column is already text.

SET lock_timeout = '5s';

BEGIN;

ALTER TABLE employee.hrms_employees
  ALTER COLUMN mobile TYPE text;

COMMIT;
