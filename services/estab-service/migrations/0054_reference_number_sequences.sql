-- Purpose: replace every Date.now()/Math.random() human-facing reference number in
-- estab-service with a Postgres SEQUENCE (same fix as drainage-service 0003, PR #2182).
--
-- Generators replaced (src/shared/numbers.ts allocates them with nextval()):
--   booking/domain.ts       generateBookingNumber()  BK-<base36 time>-<rand>   -> BK-YYYY-000123
--   citizen-lease/domain.ts generateLeaseNumber()    LS-<base36 time>-<rand>   -> LS-YYYY-000123
--   citizen-lease/domain.ts generateRequestNumber()  LR-<base36 time>-<rand>   -> LR-YYYY-000123
--   files/dak-auto.ts       generateDakNo("MTG")     MTG/<year>/<random 4 digits> -> MTG/YYYY/000123
--   linkage/commands.ts     nextFileNo()             PRE/<year>/<random 4 digits> -> PRE/YYYY/000123
--
-- Booking / lease / lease-request / meeting-diary numbers are allocated by the CONSUMER inside the
-- transaction that inserts the row, so a retried command re-allocates and can never collide or be lost.
-- The from-module file number is returned to the caller in the 202 body (the web UI shows it), so it
-- is drawn from its sequence in the route handler; being a sequence value it is unique by construction
-- and a replayed command carries its own number.
--
-- Sequences are GLOBAL: the per-tenant UNIQUE indexes are unchanged and still enforced.
-- Legacy numbers can never equal a new one (new numbers have a 4-digit year and a 6-digit serial).
--
-- Seeding: one past the highest trailing serial of any existing row of that number type, and never
-- LOWER than the sequence already is, so a re-run cannot rewind it and re-issue a number. Additive and
-- idempotent.
--
-- FORCE ROW LEVEL SECURITY: the source tables are FORCE RLS and this migration runs as their OWNER with
-- no app.tenant_id GUC, so MAX() would see ZERO rows. FORCE is lifted for the read-only seed and
-- restored to exactly its previous state in the same transaction.
-- Rollback:
--   DROP SEQUENCE IF EXISTS files.file_from_module_seq;
--   DROP SEQUENCE IF EXISTS files.dak_mtg_seq;
--   DROP SEQUENCE IF EXISTS booking.booking_number_seq;
--   DROP SEQUENCE IF EXISTS citizen_lease.lease_number_seq;
--   DROP SEQUENCE IF EXISTS citizen_lease.lease_request_number_seq;
-- Affected services: estab-service

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS files.file_from_module_seq START 1;
CREATE SEQUENCE IF NOT EXISTS files.dak_mtg_seq START 1;
CREATE SEQUENCE IF NOT EXISTS booking.booking_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS citizen_lease.lease_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS citizen_lease.lease_request_number_seq START 1;

DO $seed$
DECLARE
  spec     record;
  forced   boolean;
  max_n    bigint;
  cur_next bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('files.estab_files',                'file_no',        '^[A-Z]{1,3}/[0-9]{4}/([0-9]+)$', 'files.file_from_module_seq'),
      ('files.estab_inward',               'dak_no',         '^MTG/[0-9]{4}/([0-9]+)$',        'files.dak_mtg_seq'),
      ('booking.estab_bookings',           'booking_number', '([0-9]+)$',                      'booking.booking_number_seq'),
      ('citizen_lease.estab_leases',       'lease_number',   '([0-9]+)$',                      'citizen_lease.lease_number_seq'),
      ('citizen_lease.estab_lease_requests','request_number','([0-9]+)$',                      'citizen_lease.lease_request_number_seq')
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estab_svc') THEN
    GRANT USAGE, SELECT, UPDATE ON SEQUENCE files.file_from_module_seq, files.dak_mtg_seq,
      booking.booking_number_seq, citizen_lease.lease_number_seq, citizen_lease.lease_request_number_seq
      TO estab_svc;
  END IF;
END
$grant$;
COMMIT;
