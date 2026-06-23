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

DROP TRIGGER IF EXISTS trg_events_immutable ON events.events;
CREATE TRIGGER trg_events_immutable
  BEFORE UPDATE OR DELETE ON events.events
  FOR EACH ROW
  EXECUTE FUNCTION events.reject_audit_mutation();

-- 2) Defense-in-depth: remove UPDATE/DELETE grants from the service role.
REVOKE UPDATE, DELETE ON events.events FROM audit_svc;

-- INSERT (append) and SELECT (read / hash-chain verification) remain allowed.
