-- Purpose: Close a duplicate-reference-number bug found during hardening
-- review of registrations/consumer.ts and licences/consumer.ts: both used
-- `Date.now() % 999999` to pick the trailing digits of the human-facing
-- registration_number / licence_number (see registrations/domain.ts's
-- generateRegistrationNumber and licences/domain.ts's generateLicenceNumber).
-- Date.now() % 999999 is periodic on ~999999ms (~16.7 minutes), so any two
-- commands processed ~16.7 minutes apart (or any multiple thereof) reserve
-- the identical number -- a real collision under normal load, not a
-- theoretical one. Both columns already carry a UNIQUE constraint
-- (migrations/0001_initial.sql), so the second insert of a colliding pair
-- fails outright with a hard DB error rather than silently duplicating --
-- but that's a visible outage for a citizen/officer, not a fix.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in registrations/repo.ts's nextRegistrationNumber and
-- licences/repo.ts's nextLicenceNumber, called via nextval() from inside
-- the same transaction that inserts the row): one Postgres SEQUENCE per
-- number type, replacing Date.now() % 999999. Same fix shape as
-- animal-service's identical bug (see services/animal-service/migrations/
-- 0002_number_sequences.sql) and inspection-service's before that.
--
-- Ownership: vendor-service's migrations run as vendor_svc itself
-- (infra/db/bootstrap/bootstrap_municipal_services.sql: "CREATE DATABASE
-- civitas_vendor OWNER vendor_svc"), and vendor_svc owns the `vendor`
-- schema it created in 0001_initial.sql -- a sequence created here needs no
-- separate grant, exactly like every table in this schema already.
--
-- Seeding: setval() to one past the highest existing trailing number, so a
-- table that already has rows can't hand out a number that collides with
-- one already in use. GREATEST(1, ...) keeps the seed >= 1 (default
-- sequences have MINVALUE 1); an empty table (MAX IS NULL) seeds at 1,
-- identical to a fresh `START 1` sequence's first nextval().
--
-- Scope: GLOBAL sequences, not per-tenant -- matches the counters they
-- replace, which took no tenant argument (every call site invokes
-- generateRegistrationNumber("ULB", ...) / generateLicenceNumber("ULB", ...)
-- with the same literal "ULB" short code regardless of tenant).
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS vendor.registration_number_seq;
--   DROP SEQUENCE IF EXISTS vendor.licence_number_seq;
-- Affected services: vendor-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS vendor.registration_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS vendor.licence_number_seq START 1;

SELECT setval('vendor.registration_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(registration_number, '(\d+)$'))[1]::bigint)
              FROM vendor.vendor_registrations), 0) + 1), false);
SELECT setval('vendor.licence_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(licence_number, '(\d+)$'))[1]::bigint)
              FROM vendor.vendor_licences), 0) + 1), false);
