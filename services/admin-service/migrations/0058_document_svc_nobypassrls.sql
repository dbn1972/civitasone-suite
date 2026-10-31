-- Migration: 0058_document_svc_nobypassrls.sql
-- Purpose: UAT F84 (HIGH) — the live document_svc app role had rolbypassrls = true, although
-- document-service's migrations (0007_bulk_scan_scanner_role.sql, shared/scanner-db.ts) are written
-- for a NOBYPASSRLS service role. Same fix shape as 0018_nobypassrls_service_roles.sql:
--   1. ALTER ROLE document_svc NOBYPASSRLS (guarded on the role existing; re-running is a no-op).
--   2. Assert the "no *_svc app role holds BYPASSRLS" invariant for EVERY *_svc role, so a drifted
--      role fails this migration loudly instead of silently bypassing RLS.
-- Unchanged by design: the *_scanner roles (0018 / 0030 convention: dedicated, read-only, BYPASSRLS
-- for cross-tenant discovery) and telephony_did_resolver (telephony 0019: NOLOGIN, owns one
-- SECURITY DEFINER function); neither name ends in _svc.
--
-- DEPLOY ORDER (UAT): document-worker's cross-tenant bulk-scan discovery (dispatcher, lease
-- sweeper, upload expiry, retention) must already read through document_scanner via
-- DOCUMENT_SCANNER_DATABASE_URL BEFORE this runs. Without it the worker falls back (dev/test
-- only) to DATABASE_URL = document_svc, which after this migration sees zero bulk_scan rows.
-- See the PR / docs/runbooks/launch-undeployed-services.md for the exact steps.
--
-- MUST RUN AS A SUPERUSER (ALTER ROLE ... NOBYPASSRLS). scripts/ci/bootstrap-postgres.sh routes it
-- to the superuser connection automatically (needs_superuser(): content contains ALTER ROLE).
-- Idempotent, no data change. Rollback (superuser, NOT in production): ALTER ROLE document_svc BYPASSRLS;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_svc') THEN
    ALTER ROLE document_svc NOBYPASSRLS;
  END IF;
END
$$;

DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO offenders
  FROM pg_roles
  WHERE rolname LIKE '%\_svc' ESCAPE '\' AND rolbypassrls;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'F84: app service roles must be NOBYPASSRLS; found BYPASSRLS on: %', offenders;
  END IF;
END
$$;
