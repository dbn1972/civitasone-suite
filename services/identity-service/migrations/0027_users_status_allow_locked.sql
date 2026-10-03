-- 0027_users_status_allow_locked.sql
-- Purpose: users.users.status is a 4-state machine (active, suspended, locked, deactivated):
--   domain.ts ALLOWED, the zod statusBody and the admin UI all include 'locked', but
--   0015_check_constraints_status_columns.sql only allowed active/suspended/deactivated, so a
--   lock could never be stored (the UPDATE violated users_status_check).
-- Idempotent: DROP ... IF EXISTS, re-add NOT VALID (no long table lock), then VALIDATE.
-- Rollback: ALTER TABLE users.users DROP CONSTRAINT IF EXISTS users_status_check;
--           ALTER TABLE users.users ADD CONSTRAINT users_status_check
--             CHECK (status IN ('active','suspended','deactivated')) NOT VALID;
--           (only valid while no row is 'locked')
-- Affected services: identity-service

SET lock_timeout = '5s';

ALTER TABLE users.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users.users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'suspended', 'locked', 'deactivated'))
  NOT VALID;
ALTER TABLE users.users VALIDATE CONSTRAINT users_status_check;
