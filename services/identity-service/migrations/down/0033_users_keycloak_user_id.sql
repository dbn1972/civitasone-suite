-- Down-migration for 0033_users_keycloak_user_id.sql (FQ14).
--
-- Removes the Keycloak-sub mapping column. After this, the internal
-- /identity/internal/users/:id/email|status lookups resolve identity ids only
-- again, so HRMS's email-fallback auto-link and the HR login-link route's
-- login verification stop working for Keycloak subs. Existing
-- hrms_employees.user_ref links are unaffected.
--
-- Run via scripts/ops/migrate-rollback.sh, never by hand.

SET lock_timeout = '5s';

DROP INDEX IF EXISTS users.users_keycloak_user_id_uq;
ALTER TABLE users.users DROP COLUMN IF EXISTS keycloak_user_id;
