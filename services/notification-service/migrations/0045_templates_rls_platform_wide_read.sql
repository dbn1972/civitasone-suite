-- Fix: real tenants cannot read platform-wide (sentinel tenant_id = zero UUID)
-- rows in templates.templates, so every notification.send using a seeded
-- system/municipal template (0003_system_templates.sql,
-- 0044_municipal_templates.sql) silently resolves `template = undefined` in
-- deliveries/consumer.ts (processSend, ~line 137-138) and ships a delivery
-- with body "(no template body)" / subject NULL instead of the real content.
--
-- Root cause: the currently active policy on templates.templates
-- (`tenant_isolation_policy`, created in 0007_rls_full_tenant_isolation.sql,
-- superseding 0006's `tenant_isolation`) is a single blanket policy for ALL
-- commands: USING/WITH CHECK (tenant_id = templates.current_tenant_id()).
-- A real tenant's current_tenant_id() is never the zero UUID, so rows seeded
-- with tenant_id = '00000000-0000-0000-0000-000000000000' are invisible to
-- every real tenant, even though they own the table (FORCE ROW LEVEL
-- SECURITY applies RLS to the owner too).
--
-- Fix shape: do NOT touch the existing all-commands policy (it correctly
-- restricts INSERT/UPDATE/DELETE to a tenant's own rows and must keep doing
-- so -- ordinary tenants must never be able to write the platform-wide
-- default templates). Instead ADD a second, purely additive PERMISSIVE
-- policy that applies to SELECT only, and grants visibility into the
-- sentinel-tenant rows to every session regardless of its own
-- app.tenant_id. Postgres ORs together permissive policies for the same
-- command, so for SELECT a row is now visible if EITHER policy's predicate
-- holds (own tenant OR platform-wide); for INSERT/UPDATE/DELETE only the
-- original all-commands policy applies, so writes remain scoped to a
-- tenant's own rows exactly as before.
--
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_wide_template_read ON templates.templates;

CREATE POLICY platform_wide_template_read ON templates.templates
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

-- Sanity: the pre-existing all-commands policy must still be exactly the
-- tenant-scoped one from 0007 -- re-assert it here so this migration is
-- self-documenting and re-runnable even if 0007's policy were ever dropped
-- by hand. This does NOT change its predicate or the commands it covers.
DO $body$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'templates' AND tablename = 'templates'
      AND policyname = 'tenant_isolation_policy'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON templates.templates
      USING (tenant_id = templates.current_tenant_id())
      WITH CHECK (tenant_id = templates.current_tenant_id())';
  END IF;
END
$body$;
