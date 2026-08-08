-- 0013: let the provisioning runner (PROVISIONING_RUNNER_DSN / civitas_admin)
-- scan and update install.silo_provisions for the worker poll loop.
--
-- findPollable() in provisioning/repo.ts runs against the privileged runner
-- connection (cross-tenant, no app.tenant_id GUC). Schema `install` is owned by
-- install_svc, and FORCE RLS applies even to the table owner — so without an
-- explicit grant + policy, civitas_admin (NOSUPERUSER NOBYPASSRLS) fails with
-- "permission denied for schema install" and can never see pollable rows.
--
-- Additive / idempotent. Does NOT grant BYPASSRLS (platform rule: civitas_admin
-- stays NOBYPASSRLS). Instead a dedicated policy allows the runner role.
--
-- Rollback:
--   DROP POLICY IF EXISTS silo_provisions_provisioning_runner ON install.silo_provisions;
--   REVOKE ALL ON TABLE install.silo_provisions FROM civitas_admin;
--   REVOKE USAGE ON SCHEMA install FROM civitas_admin;

SET lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'civitas_admin') THEN
    GRANT USAGE ON SCHEMA install TO civitas_admin;
    GRANT SELECT, UPDATE ON TABLE install.silo_provisions TO civitas_admin;

    DROP POLICY IF EXISTS silo_provisions_provisioning_runner ON install.silo_provisions;
    CREATE POLICY silo_provisions_provisioning_runner ON install.silo_provisions
      FOR ALL
      TO civitas_admin
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
