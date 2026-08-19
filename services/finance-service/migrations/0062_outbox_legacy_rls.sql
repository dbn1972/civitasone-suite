-- DB-M3: Disable RLS on _outbox.messages_legacy (internal relay table, no tenant isolation needed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='_outbox' AND table_name='messages_legacy') THEN
    DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages_legacy;
    DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages_legacy;
    ALTER TABLE _outbox.messages_legacy NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages_legacy DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;
