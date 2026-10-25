-- 0003_reference_number_sequences.sql
-- CLOS3-S4-09: application and permit reference numbers were generated with randomInt(1, 999999) and
-- inserted into a UNIQUE column. A collision (about 50% once ~1200 numbers exist) threw inside the
-- consumer transaction AFTER the caller already held a 202, so the accepted request was silently lost.
-- They now come from Postgres sequences (same fix as drainage #2182 / swm #2209), allocated by the
-- consumer inside the transaction that inserts the row:
--   EVT/ULB/<year>/<random 6 digits>   ->  event.application_number_seq
--   EVTP/ULB/<year>/<random 6 digits>  ->  event.permit_number_seq
-- Sequences are GLOBAL (the UNIQUE number columns are global too). Seeding: one past the highest
-- trailing serial of any existing row and never LOWER than the sequence already is, so existing
-- (random) numbers are never re-issued and a re-run cannot rewind a sequence. Additive and idempotent.
-- FORCE ROW LEVEL SECURITY: the source tables are FORCE RLS and this migration runs as their OWNER with
-- no app.tenant_id GUC, so MAX() would see ZERO rows. FORCE is lifted for the read-only seed and
-- restored to exactly its previous state in the same transaction.
-- Rollback:
--   DROP SEQUENCE IF EXISTS event.application_number_seq;
--   DROP SEQUENCE IF EXISTS event.permit_number_seq;
--   (revert the commit so the consumers stop calling nextval)
-- Affected services: event-service

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS event.application_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS event.permit_number_seq START 1;

DO $seed$
DECLARE
  spec     record;
  forced   boolean;
  max_n    bigint;
  cur_next bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('event.event_applications', 'application_number', '([0-9]+)$', 'event.application_number_seq'),
      ('event.event_permits', 'permit_number',      '([0-9]+)$', 'event.permit_number_seq')
    ) AS t(tbl, col, pat, seq)
  LOOP
    SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = spec.tbl::regclass;
    IF forced THEN EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', spec.tbl); END IF;
    EXECUTE format('SELECT COALESCE(MAX((regexp_match(%I, %L))[1]::bigint), 0) FROM %s', spec.col, spec.pat, spec.tbl) INTO max_n;
    IF forced THEN EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', spec.tbl); END IF;
    EXECUTE format('SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM %s', spec.seq) INTO cur_next;
    PERFORM setval(spec.seq::regclass, GREATEST(cur_next, max_n + 1), false);
  END LOOP;
END
$seed$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'event_svc') THEN
    GRANT USAGE, SELECT, UPDATE ON SEQUENCE event.application_number_seq, event.permit_number_seq TO event_svc;
  END IF;
END
$grant$;
COMMIT;
