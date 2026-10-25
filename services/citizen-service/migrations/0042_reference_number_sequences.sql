-- Purpose: replace the Date.now()/random()/uuid-prefix human reference numbers
-- with Postgres SEQUENCEs (same fix as drainage-service 0003, #2182).
--
-- Before (all generated OUTSIDE the insert transaction and carried in the
-- command payload, so a UNIQUE-violation retry replayed the same value and an
-- accepted (202) command could be silently lost):
--   application ref_no     APP-${Date.now()}                 (UNIQUE tenant,ref_no)
--   intake tracking_no     CIT-YYYY-<4 random bytes as hex>  (UNIQUE tenant,tracking_no; ~65k/yr birthday risk)
--   RTI rti_no             RTI/YYYY/${Date.now()}            (UNIQUE tenant,rti_no)
--   helpdesk ticket_no     HD-<first 8 hex of the row uuid>
--   engagement notice_no   NTC-YYYY-<first 8 hex of the row uuid> (UNIQUE tenant,notice_no)
--
-- After: allocated with nextval() -- by the CONSUMER inside the insert
-- transaction (application, RTI, notice) or, for the two numbers the 202
-- response must carry back synchronously (intake tracking_no, helpdesk
-- ticket_no), by the route immediately before publish. Either way the value is
-- unique by construction, so a retry can never collide. Format:
--   APP-YYYY-000123  CIT-YYYY-000123  RTI/YYYY/000123  HD-YYYY-000123  NTC-YYYY-000123
-- (year in IST). Sequences are GLOBAL: the UNIQUE indexes are per tenant, and a
-- global counter satisfies them trivially.
--
-- Legacy values can never equal a new value: APP/HD legacy forms have no
-- "-YYYY-" segment; legacy CIT/NTC suffixes are 8 hex chars and RTI legacy
-- suffixes are 13-digit epoch millis, while the sequences below are CAPPED
-- (MAXVALUE, NO CYCLE) at 7 / 7 / 9 digits so a new value is never as long as
-- a legacy one (exhaustion errors loudly instead of wrapping).
--
-- Seeding: one past the highest trailing number of any existing row in the NEW
-- format, and never LOWER than the sequence already is (a re-run cannot rewind
-- it and re-issue numbers). Additive and idempotent.
--
-- NO FORCE ... FORCE: all source tables are FORCE ROW LEVEL SECURITY and this
-- migration runs as their OWNER (citizen_svc, a non-superuser, so FORCE applies
-- to it) with no app.tenant_id GUC set. Without lifting FORCE for the seed
-- reads, MAX() sees ZERO rows and the sequences would be seeded to 1. The seeds
-- are cross-tenant by nature (the sequences are global); each table's FORCE
-- flag is restored to exactly its prior value in the same transaction.
-- Rollback:
--   DROP SEQUENCE IF EXISTS application.application_ref_seq;
--   DROP SEQUENCE IF EXISTS application.tracking_no_seq;
--   DROP SEQUENCE IF EXISTS rti.rti_no_seq;
--   DROP SEQUENCE IF EXISTS helpdesk.ticket_no_seq;
--   DROP SEQUENCE IF EXISTS engagement.notice_no_seq;
-- Affected services: citizen-service

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS application.application_ref_seq START 1 MAXVALUE 999999999 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS application.tracking_no_seq     START 1 MAXVALUE 9999999   NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS rti.rti_no_seq                  START 1 MAXVALUE 999999999 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS helpdesk.ticket_no_seq          START 1 MAXVALUE 999999999 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS engagement.notice_no_seq        START 1 MAXVALUE 9999999   NO CYCLE;

DO $$
DECLARE
  r      record;
  forced boolean;
  maxn   bigint;
  cur    bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('application.citizen_applications', 'ref_no',      '^APP-[0-9]{4}-([0-9]{1,9})$',  'application.application_ref_seq'),
    ('application.citizen_applications', 'tracking_no', '^CIT-[0-9]{4}-([0-9]{1,7})$',  'application.tracking_no_seq'),
    ('rti.citizen_rti_requests',         'rti_no',      '^RTI/[0-9]{4}/([0-9]{1,9})$',  'rti.rti_no_seq'),
    ('helpdesk.citizen_tickets',         'ticket_no',   '^HD-[0-9]{4}-([0-9]{1,9})$',   'helpdesk.ticket_no_seq'),
    ('engagement.citizen_notices',       'notice_no',   '^NTC-[0-9]{4}-([0-9]{1,7})$',  'engagement.notice_no_seq')
  ) AS t(tbl, col, rx, seq)
  LOOP
    SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = r.tbl::regclass;
    IF forced THEN EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', r.tbl); END IF;

    EXECUTE format('SELECT COALESCE(MAX((regexp_match(%I, %L))[1]::bigint), 0) FROM %s', r.col, r.rx, r.tbl) INTO maxn;
    EXECUTE format('SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM %s', r.seq) INTO cur;
    PERFORM setval(r.seq, GREATEST(cur, maxn + 1), false);

    IF forced THEN EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', r.tbl); END IF;
  END LOOP;
END
$$;

COMMIT;
