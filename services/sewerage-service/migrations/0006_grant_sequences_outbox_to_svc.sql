-- Purpose: grant sewerage_svc what the worker needs on objects created by whoever
-- ran the migrations. UAT DB test (2026-10-28, g7-municipal defect 3): 0003 assumed sewerage_svc OWNS
-- civitas_sewerage and needs no GRANT, but in deployed environments migrations
-- run as civitas_admin, so the number sequences and the shared _outbox.messages /
-- _inbox.processed tables are admin-owned and the worker failed with
-- "permission denied for table messages / processed" and never applied a write.
-- Pattern: building-service 0001_init.sql "Grants". Additive and idempotent;
-- a no-op when sewerage_svc does not exist.
-- Rollback: REVOKE the same privileges FROM sewerage_svc (no objects are created).
-- Affected services: sewerage-service

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sewerage_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO sewerage_svc;
    GRANT USAGE ON SCHEMA _inbox TO sewerage_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages TO sewerage_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON _inbox.processed TO sewerage_svc;
    GRANT USAGE ON SCHEMA civitas_sewerage TO sewerage_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA civitas_sewerage TO sewerage_svc;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA civitas_sewerage TO sewerage_svc;
  END IF;
END $$;
