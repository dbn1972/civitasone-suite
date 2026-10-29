-- FQ12 (UAT #130-#134): drop the legacy rls_* policies from 0004 on orchestrator.*.
--
-- 0004 created rls_wizard_definitions / rls_step_definitions / rls_step_executions
-- with USING (tenant_id = current_setting('app.tenant_id')::uuid) -- no missing_ok,
-- so they THROW ("unrecognized configuration parameter" or, once the GUC has been
-- reset in a pooled session, `invalid input syntax for type uuid: ""`) instead of
-- matching no rows. 0006 added tenant_isolation_policy (install.current_tenant_id())
-- on the same tables but only dropped policies named tenant_isolation, so both
-- coexisted (permissive policies OR together; either one erroring fails the query).
--
-- Guarded + idempotent: a legacy policy is dropped only when the table also has
-- tenant_isolation_policy, so tenant isolation never lapses. Re-running is a no-op.
-- Rollback: re-create the three policies exactly as in 0004_orchestrator.sql.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wizard_definitions', 'step_definitions', 'step_executions'] LOOP
    IF EXISTS (
         SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'orchestrator' AND c.relname = t AND p.polname = 'tenant_isolation_policy')
       AND EXISTS (
         SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'orchestrator' AND c.relname = t AND p.polname = 'rls_' || t)
    THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON orchestrator.%I', 'rls_' || t, t);
    END IF;
  END LOOP;
END $$;
