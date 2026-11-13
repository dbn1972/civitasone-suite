-- Down-migration for 0034_onboarding_usable_logins.sql.
-- Drops the per-tenant onboarding switch (tenants fall back to today's create behaviour, which is the default
-- anyway) and any outstanding set-password tokens (admins must issue new links). No user or credential data is lost.
-- Run via scripts/ops/migrate-rollback.sh, never by hand.

SET lock_timeout = '5s';

DROP TABLE IF EXISTS users.password_setup_tokens;
DROP TABLE IF EXISTS users.tenant_onboarding_settings;
