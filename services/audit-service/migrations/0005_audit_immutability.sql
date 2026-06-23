-- AUD-1: enforce audit immutability at the DB level (was app-convention only)
REVOKE UPDATE, DELETE ON events.events FROM audit_svc;
CREATE OR REPLACE FUNCTION events.prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events.events is append-only (immutable audit log); % rejected', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_events_immutable ON events.events;
CREATE TRIGGER trg_events_immutable
  BEFORE UPDATE OR DELETE ON events.events
  FOR EACH ROW EXECUTE FUNCTION events.prevent_mutation();
