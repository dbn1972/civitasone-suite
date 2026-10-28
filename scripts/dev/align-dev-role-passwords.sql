-- DEV/CI ONLY. Never run against a production cluster.
--
-- Aligns the password of the BYPASSRLS scanner roles with the dev default that
-- ecosystem.config.js scannerDbUrl() injects (<role>_dev_pw). Their creating
-- migrations (asset 0026, journey 0006, legal 0028, smarttransfer 0002, ...)
-- deliberately give a random password unless a civitas.<x>_password GUC is set,
-- and applied migrations must not be edited, so a hand-provisioned dev DB ends
-- up with scanner roles the worker cannot log in as (UAT DB test 2026-10-28).
-- The password is derived at run time, so no credential literal is committed.
-- Idempotent; roles that do not exist yet are skipped (run again after migrate).
--
--   psql -h <host> -U <superuser> -d postgres -v ON_ERROR_STOP=1 \
--        -f scripts/dev/align-dev-role-passwords.sql
DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname ~ '_scanner$' LOOP
    EXECUTE format('ALTER ROLE %I PASSWORD %L', r, r || '_dev_pw');
  END LOOP;
END $$;
