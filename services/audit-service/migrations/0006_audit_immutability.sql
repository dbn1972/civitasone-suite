-- audit-service immutability enforcement (AUD-1 / 06-T1).
-- Applied with audit_svc role on civitas_audit after 0005_world_class.sql.
--
-- events.events is APPEND-ONLY. Until now this was convention only: migration
-- 0004 left the REVOKE commented out and there was no trigger, so the tamper-
-- evident audit log was in practice UPDATE-able and DELETE-able. This migration
-- enforces immutability at the database layer so the hash chain cannot be
-- silently rewritten.
--
-- NOTE: a table OWNER bypasses its own column/table GRANTs, so the REVOKE below
-- is defense-in-depth for non-owner roles; the BEFORE UPDATE OR DELETE trigger
-- is the authoritative guard because it fires regardless of role or ownership.

-- 1) Authoritative guard: reject every UPDATE/DELETE on the audit log.
CREATE OR REPLACE FUNCTION events.reject_audit_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'events.events is append-only: % is not permitted on the audit log (AUD-1)',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- IDEMPOTENCY (GAP2-PLATFORM-MIGRATIONS-IDEMPOTENT-02): the REVOKE below strips
-- the owner's own TRIGGER privilege from the parent's ACL and, via partition
-- propagation, from each child partition. A second run of a bare
-- `CREATE TRIGGER events.events` (which cascades to every partition) then fails
-- with "permission denied for table events_yYYYYmMM" on the first partition.
-- Fix: re-grant TRIGGER to the owner across the whole partition tree first,
-- then (re)create the trigger. The owner may grant on tables it owns, so this
-- runs under the migration's own audit_svc role. This block also makes 0006
-- authoritative over 0005 (same trigger name, newer reject_audit_mutation
-- function) on every run, not just the first.
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
  FOR EACH ROW
  EXECUTE FUNCTION events.reject_audit_mutation();

-- 2) Defense-in-depth: remove UPDATE/DELETE grants from the service role.
REVOKE UPDATE, DELETE ON events.events FROM audit_svc;

-- INSERT (append) and SELECT (read / hash-chain verification) remain allowed.
