-- Purpose: Close a duplicate-reference-number bug class found during Wave 2
-- hardening review of sewerage-service: application_number, connection_number,
-- bill_number, complaint_number and booking_number were each a bare
-- `SEW{,C,B,,D}-${Date.now()}` template literal computed synchronously in
-- the HTTP route's command handler (before the command is even published to
-- the queue). Date.now() is millisecond-resolution wall-clock time -- two
-- create requests processed in the same millisecond (concurrent load, or a
-- retried request) reserve the identical number. Unlike parks-service's
-- identical bug (migrations/0002_number_sequences.sql), every one of these
-- five columns already carries a bare (non-tenant-scoped) UNIQUE constraint
-- from 0001_initial.sql, so the practical failure mode here is a hard
-- constraint-violation 500 on the second concurrent request rather than
-- silent duplication -- still a real production bug (an ordinary retry, or
-- two concurrent officers submitting at once, turns into an unhandled
-- error), just a different failure shape. Same fix shape as
-- animal-service/vendor-service/parks-service's identical bug tonight.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in each module's repo.ts's nextXNumber + domain.ts's
-- formatXNumber (billing/consumer.ts formats inline instead, since that
-- module has no domain.ts), each called via nextval() from inside the same
-- consumer transaction that inserts the row): one Postgres SEQUENCE per
-- number type, replacing Date.now(). The existing bare UNIQUE constraints
-- from 0001_initial.sql are left as is -- they remain real, useful defense
-- in depth (e.g. against a future code path that bypasses the sequence
-- entirely), just no longer the ONLY thing standing between two concurrent
-- requests and a 500.
--
-- Ownership: sewerage_svc is the OWNER of civitas_sewerage (see
-- infra/db/bootstrap/bootstrap_sewerage.sql) and of every table 0001
-- created in it -- a sequence created here needs no separate GRANT,
-- matching parks-service/animal-service's identical ownership model.
--
-- Seeding: setval() to one past the highest existing trailing numeric
-- suffix per table, so an already-populated table (should one exist in some
-- environment despite the "empty" note in 0002) can't hand out a colliding
-- number. GREATEST(1, ...) keeps the seed >= 1 (default MINVALUE); an empty
-- table (MAX IS NULL) seeds at 1, identical to a fresh `START 1` sequence's
-- first nextval().
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS civitas_sewerage.application_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_sewerage.connection_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_sewerage.bill_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_sewerage.complaint_number_seq;
--   DROP SEQUENCE IF EXISTS civitas_sewerage.booking_number_seq;
-- Affected services: sewerage-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS civitas_sewerage.application_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_sewerage.connection_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_sewerage.bill_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_sewerage.complaint_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS civitas_sewerage.booking_number_seq START 1;

SELECT setval('civitas_sewerage.application_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(application_number, '(\d+)$'))[1]::bigint)
              FROM civitas_sewerage.sewerage_applications), 0) + 1), false);
SELECT setval('civitas_sewerage.connection_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(connection_number, '(\d+)$'))[1]::bigint)
              FROM civitas_sewerage.sewerage_connections), 0) + 1), false);
SELECT setval('civitas_sewerage.bill_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(bill_number, '(\d+)$'))[1]::bigint)
              FROM civitas_sewerage.sewerage_bills), 0) + 1), false);
SELECT setval('civitas_sewerage.complaint_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(complaint_number, '(\d+)$'))[1]::bigint)
              FROM civitas_sewerage.sewerage_complaints), 0) + 1), false);
SELECT setval('civitas_sewerage.booking_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(booking_number, '(\d+)$'))[1]::bigint)
              FROM civitas_sewerage.sewerage_desludging_bookings), 0) + 1), false);
