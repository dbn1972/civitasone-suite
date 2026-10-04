-- 0029_users_status_scim_disabled_to_deactivated.sql
-- Purpose: the SCIM consumer used to write users.users.status = disabled for active=false and DELETE,
--   a value users_status_check (0015/0027) never allowed, so those writes failed at the database.
--   The canonical vocabulary is active | suspended | locked | deactivated; SCIM now writes deactivated.
--   This migration normalises any legacy disabled row (none can exist under the validated CHECK, but a
--   restored/imported dataset might carry some) and re-asserts the constraint.
-- Idempotent: the UPDATE is a no-op once no disabled rows remain; the constraint is only re-added when missing.
-- Rollback: no schema change to undo (rows set to deactivated stay deactivated).
-- Affected services: identity-service

SET lock_timeout = '5s';

ALTER TABLE users.users DROP CONSTRAINT IF EXISTS users_status_check;
UPDATE users.users SET status = 'deactivated' WHERE status = 'disabled';
ALTER TABLE users.users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'suspended', 'locked', 'deactivated'))
  NOT VALID;
ALTER TABLE users.users VALIDATE CONSTRAINT users_status_check;
