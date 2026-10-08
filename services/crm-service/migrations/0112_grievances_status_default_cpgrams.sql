-- 0112_grievances_status_default_cpgrams.sql
-- GAP2-CRM-GRIEVANCES-SCHEMA-04 — fix DEFAULT / CHECK drift on crm.grievances.status.
--
-- Migration 0082 (CPGRAMS alignment) dropped the old status CHECK and added
--   grievances_status_cpgrams_check CHECK (status IN
--     ('REGISTERED','FORWARDED','ATTENDED','DISPOSED','APPEAL'))
-- but left the column DEFAULT at the pre-0082 value 'open' (set in 0079).
-- 'open' is no longer an allowed value, so any INSERT that omits `status`
-- fails the table's own CHECK constraint. This realigns the DEFAULT with the
-- CPGRAMS vocabulary so a status-less INSERT lands on the opening state.
--
-- Additive + idempotent: ALTER ... SET DEFAULT is unconditional and safe to
-- re-run. No data is rewritten (existing rows already carry CPGRAMS values via
-- 0082 step 4).
--
-- Rollback:
--   ALTER TABLE crm.grievances ALTER COLUMN status SET DEFAULT 'open';

SET lock_timeout = '5s';

ALTER TABLE crm.grievances ALTER COLUMN status SET DEFAULT 'REGISTERED';
