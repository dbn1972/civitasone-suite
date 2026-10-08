-- AUD-1: enforce audit immutability at the DB level (was app-convention only)
REVOKE UPDATE, DELETE ON events.events FROM audit_svc;
CREATE OR REPLACE FUNCTION events.prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events.events is append-only (immutable audit log); % rejected', TG_OP;
END;
$$ LANGUAGE plpgsql;
-- IDEMPOTENCY (GAP2-PLATFORM-MIGRATIONS-IDEMPOTENT-02): a later migration
-- (0011_audit_truncate_guard.sql) REVOKEs TRIGGER on events.events from the
-- owner, so on a SECOND bootstrap run this DROP+CREATE TRIGGER fails with
-- "permission denied for table events_yYYYYmMM" on the first partition
-- (CREATE TRIGGER on a partitioned parent cascades to every partition). The
-- owner may always GRANT on tables it owns, so re-grant TRIGGER across the
-- whole partition tree first; this is harmless on the first run (owner still
-- holds it) and unblocks the re-run. Mirrors the pattern 0029 later uses.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS nsp, c.relname AS rel
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.inhparent = 'events.events'::regclass
    UNION ALL
    SELECT 'events', 'events'
  LOOP
    EXECUTE format('GRANT TRIGGER ON %I.%I TO audit_svc', r.nsp, r.rel);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_events_immutable ON events.events;
CREATE TRIGGER trg_events_immutable
  BEFORE UPDATE OR DELETE ON events.events
  FOR EACH ROW EXECUTE FUNCTION events.prevent_mutation();
