-- Purpose: V4-C-04 -- reference numbers in this service were built from
-- crypto.randomInt(1, 999999) into fleet-global UNIQUE columns, so birthday
-- collisions (~50% at ~1200 records) made the consumer insert fail AFTER the
-- caller had already received 202. Replaced by one Postgres SEQUENCE per
-- column, drawn with nextval() inside the consumer transaction.
-- Scope: GLOBAL sequences (the columns are global-unique and the old counter
-- took no tenant argument). Seeded one past the highest existing trailing
-- number so already-issued numbers cannot be re-issued. Idempotent: the seed
-- is GREATEST(current last_value, max+1) so re-applying never moves it back.
-- Rollback:
--   DROP SEQUENCE IF EXISTS parking.booking_number_seq;
--   DROP SEQUENCE IF EXISTS parking.pass_number_seq;
--   DROP SEQUENCE IF EXISTS parking.violation_number_seq;
--   (then revert the application change, which calls nextval on them)
-- Affected services: parking-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS parking.booking_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS parking.pass_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS parking.violation_number_seq START 1;

-- The seed reads FORCE-RLS tables as their owner, which would otherwise see zero
-- rows (no tenant GUC): lift FORCE for the read, restore it right after.
ALTER TABLE parking.parking_bookings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_passes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_violations NO FORCE ROW LEVEL SECURITY;

SELECT setval(
  'parking.booking_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM parking.booking_number_seq),
    COALESCE((SELECT MAX((regexp_match(booking_number, '(\d+)$'))[1]::bigint)
                FROM parking.parking_bookings), 0)
  ) + 1,
  false);

SELECT setval(
  'parking.pass_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM parking.pass_number_seq),
    COALESCE((SELECT MAX((regexp_match(pass_number, '(\d+)$'))[1]::bigint)
                FROM parking.parking_passes), 0)
  ) + 1,
  false);

SELECT setval(
  'parking.violation_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM parking.violation_number_seq),
    COALESCE((SELECT MAX((regexp_match(violation_number, '(\d+)$'))[1]::bigint)
                FROM parking.parking_violations), 0)
  ) + 1,
  false);

ALTER TABLE parking.parking_bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_passes FORCE ROW LEVEL SECURITY;
ALTER TABLE parking.parking_violations FORCE ROW LEVEL SECURITY;
