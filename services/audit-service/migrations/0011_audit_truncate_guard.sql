-- audit-service TRUNCATE guard (Platform Review R3 / S3).
-- The 0006 immutability trigger is BEFORE UPDATE OR DELETE FOR EACH ROW, which
-- does NOT fire on TRUNCATE. Combined with grant-all.mjs `GRANT ALL` (which
-- includes TRUNCATE), the append-only audit log could be wiped without tripping
-- any guard. This closes that bypass: a statement-level BEFORE TRUNCATE trigger
-- + explicit REVOKE TRUNCATE.

CREATE OR REPLACE FUNCTION events.reject_audit_truncate()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'events.events is append-only: TRUNCATE is not permitted on the audit log (AUD-1/R3)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_events_no_truncate ON events.events;
CREATE TRIGGER trg_events_no_truncate
  BEFORE TRUNCATE ON events.events
  FOR EACH STATEMENT
  EXECUTE FUNCTION events.reject_audit_truncate();

-- Defense-in-depth: remove TRUNCATE (and TRIGGER, so the guard can't be dropped)
-- from the service role. Owner still bypasses GRANTs — the trigger is authoritative.
REVOKE TRUNCATE, TRIGGER ON events.events FROM audit_svc;
