-- Purpose: (Re-)apply tenant RLS to _outbox.messages (and _inbox.processed
-- when it has tenant_id) when the connecting role owns them.
-- Mirrors works-service 0013_outbox_inbox_rls.sql / visitor-service
-- 0013_outbox_inbox_rls.sql / court-service 0015_outbox_inbox_rls.sql.
-- Safe no-op if not owner.
--
-- Note: 0015_rls_tenant_isolation.sql and 0026_rls_full_tenant_isolation.sql
-- already enabled FORCE RLS + a `tenant_isolation_policy` on _outbox.messages
-- (using the existing payroll.current_tenant_id() helper) when payroll_svc
-- owns the table. The block below is idempotent — it re-applies the SAME
-- policy under an owner guard so this migration is a safe re-run even where
-- those earlier migrations already did the work.
--
-- Deploy note: payroll-worker MUST run startRelay(scannerDb, …) and
-- startOutboxPurge(scannerDb, …) (see src/worker.ts). The outbox relay/purge
-- are cross-tenant scans and payroll_scanner is BYPASSRLS (migration
-- 0032_payroll_scanner_role.sql) with grants on _outbox/_inbox.
--
-- Lesson learned from visitor-service (0013): payroll-service's
-- _inbox.processed (from @civitasone/outbox's shared outboxSchema) is
-- message_id-only — no tenant_id column — so tenant RLS cannot apply there.
-- The DO block below detects this and skips with a NOTICE rather than
-- guessing/adding a fabricated tenant scope.
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
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
  EXECUTE $f$CREATE POLICY tenant_isolation_policy ON _outbox.messages
     USING (tenant_id = payroll.current_tenant_id())
     WITH CHECK (tenant_id = payroll.current_tenant_id())$f$;
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
  -- payroll-service's inbox is message_id-only (@civitasone/outbox outboxSchema) —
  -- no tenant column to scope a tenant_isolation policy on. Skip safely rather
  -- than fabricate one (visitor-service 0013 lesson).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = '_inbox' AND table_name = 'processed' AND column_name = 'tenant_id'
  ) THEN
    RAISE NOTICE 'skip _inbox.processed RLS — no tenant_id column';
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE _inbox.processed ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE _inbox.processed FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _inbox.processed';
  EXECUTE $f$CREATE POLICY tenant_isolation_policy ON _inbox.processed
     USING (tenant_id = payroll.current_tenant_id())
     WITH CHECK (tenant_id = payroll.current_tenant_id())$f$;
END $$;
