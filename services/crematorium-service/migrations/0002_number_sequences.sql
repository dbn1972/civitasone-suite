-- Purpose: Close a duplicate-reference-number bug found during hardening
-- review of bookings/consumer.ts: booking_number's trailing digits came from
-- `randomInt(1, 999999)` (see domain.ts's generateBookingNumber), a
-- cryptographically random but NOT guaranteed-unique value -- a real
-- collision risk at moderate volume against crematorium_bookings'
-- booking_number UNIQUE constraint (migrations/0001_initial.sql), which
-- would reject the second insert outright: a visible outage for whichever
-- citizen/officer's request lost the race, discovered mid-transaction after
-- the caller already received 202 Accepted.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in bookings/repo.ts's nextBookingNumber, called via nextval() from
-- inside the same transaction that inserts the row): one Postgres SEQUENCE
-- for booking_number, replacing randomInt(1, 999999). Same fix shape as
-- animal-service's identical bug class (see services/animal-service/
-- migrations/0002_number_sequences.sql) and vendor-service's (services/
-- vendor-service/migrations/0002_number_sequences.sql).
--
-- Ownership: crematorium-service's migrations run as crematorium_svc itself
-- (crematorium_svc is the OWNER of civitas_crematorium and of the
-- `crematorium` schema it created in 0001_initial.sql -- see
-- infra/db/bootstrap/bootstrap_sec5_batch3.sql). A sequence created here
-- therefore needs no separate grant.
--
-- Seeding: setval() to one past the highest existing trailing number, so a
-- table that already has rows can't hand out a number that collides with
-- one already in use. GREATEST(1, ...) keeps the seed >= 1 (default
-- sequences have MINVALUE 1); an empty table (MAX IS NULL) seeds at 1,
-- identical to a fresh `START 1` sequence's first nextval().
--
-- Scope: a GLOBAL sequence, not per-tenant -- matches the counter it
-- replaces, which took no tenant argument (every call site invokes
-- generateBookingNumber("ULB", ...) with the same literal "ULB" short code
-- regardless of tenant).
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS crematorium.booking_number_seq;
-- Affected services: crematorium-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS crematorium.booking_number_seq START 1;

SELECT setval('crematorium.booking_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(booking_number, '(\d+)$'))[1]::bigint)
              FROM crematorium.crematorium_bookings), 0) + 1), false);
