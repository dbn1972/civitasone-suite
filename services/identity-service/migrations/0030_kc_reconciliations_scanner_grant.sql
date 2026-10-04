-- 0030_kc_reconciliations_scanner_grant.sql
-- Purpose: identity_kc_reconciliations is under FORCE ROW LEVEL SECURITY (0014), so the worker's reconciler, which
--   ran on the plain identity_svc connection with no tenant context, could never see a due row: a failed or crashed
--   Keycloak disable was never retried. The reconciler now DISCOVERS due rows across tenants through the existing
--   BYPASSRLS read-only identity_scanner role (0020) and then claims, updates and audits each row inside that row's
--   tenant-context transaction as identity_svc. The scanner only needs SELECT.
-- Idempotent: GRANT is a no-op when already held. The role is created by 0020; guard in case it is absent.
-- Rollback: REVOKE SELECT ON public.identity_kc_reconciliations FROM identity_scanner; (USAGE on schema public is harmless to keep)
-- Affected services: identity-service

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_scanner') THEN
    GRANT USAGE ON SCHEMA public TO identity_scanner;
    GRANT SELECT ON public.identity_kc_reconciliations TO identity_scanner;
  END IF;
END
$$;
