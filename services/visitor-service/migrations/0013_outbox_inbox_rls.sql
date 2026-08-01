-- Purpose: Apply tenant RLS to _outbox.messages / _inbox.processed when the
-- connecting role owns them. Mirrors works-service 0011_outbox_rls_if_owner.sql.
-- Safe no-op if not owner.
--
-- Deploy note: visitor-worker MUST run startRelay(scannerDb, …). The outbox
-- relay is cross-tenant and the visitor_scanner role is BYPASSRLS (0009) with
-- grants on _outbox/_inbox (0011). Using visitor_svc + FORCE RLS with no
-- app.tenant_id would starve the relay.
SET lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('_outbox.messages') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = '_outbox' AND tablename = 'messages'
      AND tableowner = current_user
  ) THEN
    RAISE NOTICE 'skip _outbox.messages RLS — not owned by %', current_user;
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
  EXECUTE $f$CREATE POLICY tenant_isolation_policy ON _outbox.messages
     USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
     WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$f$;
END $$;

DO $$
BEGIN
  IF to_regclass('_inbox.processed') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = '_inbox' AND tablename = 'processed'
      AND tableowner = current_user
  ) THEN
    RAISE NOTICE 'skip _inbox.processed RLS — not owned by %', current_user;
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE _inbox.processed ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE _inbox.processed FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _inbox.processed';
  EXECUTE $f$CREATE POLICY tenant_isolation_policy ON _inbox.processed
     USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
     WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$f$;
END $$;
