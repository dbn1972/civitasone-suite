-- Purpose: grant swm_svc what the worker needs on objects created by whoever
-- ran the migrations. UAT DB test (2026-10-28, g7-municipal defect 4): the five number sequences created in 0005 are
-- owned by the migration-running role (civitas_admin in deployed environments)
-- and nothing granted USAGE on them to swm_svc, so every create command failed
-- with "permission denied for sequence request_number_seq" and was never applied.
-- 0002 granted _outbox/_inbox only to a role that already had schema access;
-- re-assert those plus schema USAGE and table access so the result does not
-- depend on who owns the objects.
-- Pattern: building-service 0001_init.sql "Grants". Additive and idempotent;
-- a no-op when swm_svc does not exist.
-- Rollback: REVOKE the same privileges FROM swm_svc (no objects are created).
-- Affected services: swm-service

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swm_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO swm_svc;
    GRANT USAGE ON SCHEMA _inbox TO swm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages TO swm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON _inbox.processed TO swm_svc;
    GRANT USAGE ON SCHEMA civitas_swm TO swm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA civitas_swm TO swm_svc;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA civitas_swm TO swm_svc;
  END IF;
END $$;
