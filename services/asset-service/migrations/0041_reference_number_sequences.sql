-- Purpose: replace the in-process counter + Date.now().toString(36) human
-- reference numbers (SLF-/SLR-/WA-/WC-/WB-/WT-<base36 ms>-<per-process counter>)
-- with Postgres SEQUENCEs. The old generators restarted their counter at 0 on
-- every worker restart and were not shared between worker replicas, so two
-- commands handled in the same millisecond by different processes (or by one
-- process after a restart) produced the SAME number; none of the six columns
-- had a UNIQUE constraint, so duplicates were stored silently.
--
-- The numbers are now allocated by the consumer with nextval() INSIDE the
-- transaction that inserts the row (src/shared/numbers.ts), so a retry
-- re-allocates and can never collide. Format: PREFIX-YYYY-000123 (year in IST),
-- same shape as drainage-service 0003_number_sequences.sql. Sequences are
-- GLOBAL (not per tenant), so a number is unique across the whole service.
--
--   streetlight.fault_number_seq             SLF  asset_streetlight_faults.fault_number
--   streetlight.request_number_seq           SLR  asset_streetlight_requests.request_number
--   water_connections.application_number_seq WA   asset_water_applications.application_number
--   water_connections.connection_number_seq  WC   asset_water_connections.connection_number
--   water_metering.bill_number_seq           WB   asset_water_bills.bill_number
--   water_tanker.booking_number_seq          WT   asset_water_tanker_bookings.booking_number
--
-- Seeding: one past the highest trailing digit run of any existing row so a
-- database with rows can never hand out an in-use number, and never LOWER than
-- the sequence already is (a re-run cannot rewind it and re-issue numbers).
-- Legacy numbers (PREFIX-<base36>-NNNN) can never equal a new PREFIX-YYYY-NNNNNN
-- number. Additive and idempotent. No UNIQUE constraint is added: legacy rows
-- may already hold duplicates, and the sequence makes new duplicates impossible.
--
-- NO FORCE ... FORCE: all six tables are FORCE ROW LEVEL SECURITY and this
-- migration runs as their OWNER (asset_svc, a non-superuser, so FORCE applies
-- to it too) with no app.tenant_id GUC set. Without lifting FORCE for the seed
-- reads, MAX() sees ZERO rows and every sequence would be seeded to 1 (re-issuing
-- in-use numbers on a re-run). The read-only seeds are cross-tenant by nature;
-- FORCE is restored in the same transaction (house rule 4.3 backfill idiom).
-- Rollback:
--   DROP SEQUENCE IF EXISTS streetlight.fault_number_seq;
--   DROP SEQUENCE IF EXISTS streetlight.request_number_seq;
--   DROP SEQUENCE IF EXISTS water_connections.application_number_seq;
--   DROP SEQUENCE IF EXISTS water_connections.connection_number_seq;
--   DROP SEQUENCE IF EXISTS water_metering.bill_number_seq;
--   DROP SEQUENCE IF EXISTS water_tanker.booking_number_seq;
-- Affected services: asset-service

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS streetlight.fault_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS streetlight.request_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS water_connections.application_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS water_connections.connection_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS water_metering.bill_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS water_tanker.booking_number_seq START 1;

ALTER TABLE streetlight.asset_streetlight_faults        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE streetlight.asset_streetlight_requests      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE water_connections.asset_water_applications  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE water_connections.asset_water_connections   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE water_metering.asset_water_bills            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE water_tanker.asset_water_tanker_bookings    NO FORCE ROW LEVEL SECURITY;

DO $seed$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('streetlight.fault_number_seq',             'streetlight.asset_streetlight_faults',        'fault_number'),
    ('streetlight.request_number_seq',           'streetlight.asset_streetlight_requests',      'request_number'),
    ('water_connections.application_number_seq', 'water_connections.asset_water_applications',  'application_number'),
    ('water_connections.connection_number_seq',  'water_connections.asset_water_connections',   'connection_number'),
    ('water_metering.bill_number_seq',           'water_metering.asset_water_bills',            'bill_number'),
    ('water_tanker.booking_number_seq',          'water_tanker.asset_water_tanker_bookings',    'booking_number')
  ) AS t(seq, tbl, col)
  LOOP
    EXECUTE format(
      $q$SELECT setval(%L,
           GREATEST(
             (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM %s),
             COALESCE((SELECT MAX((regexp_match(%I, '(\d+)$'))[1]::bigint) FROM %s), 0) + 1),
           false)$q$,
      r.seq, r.seq, r.col, r.tbl);
  END LOOP;
END
$seed$;

ALTER TABLE streetlight.asset_streetlight_faults        FORCE ROW LEVEL SECURITY;
ALTER TABLE streetlight.asset_streetlight_requests      FORCE ROW LEVEL SECURITY;
ALTER TABLE water_connections.asset_water_applications  FORCE ROW LEVEL SECURITY;
ALTER TABLE water_connections.asset_water_connections   FORCE ROW LEVEL SECURITY;
ALTER TABLE water_metering.asset_water_bills            FORCE ROW LEVEL SECURITY;
ALTER TABLE water_tanker.asset_water_tanker_bookings    FORCE ROW LEVEL SECURITY;
COMMIT;
