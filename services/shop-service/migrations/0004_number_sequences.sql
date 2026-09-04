-- Purpose: Close a duplicate-reference-number bug found during hardening
-- review of registrations/consumer.ts and permits/consumer.ts: both used
-- `Date.now() % 999999` to pick the trailing digits of the human-facing
-- application_number / permit_number (see registrations/domain.ts's
-- generateApplicationNumber and permits/domain.ts's generatePermitNumber).
-- Date.now() % 999999 is periodic on ~999999ms (~16.7 minutes), so any two
-- commands processed ~16.7 minutes apart (or any multiple thereof) reserve
-- the identical number -- a real collision under normal load, not a
-- theoretical one. Both columns already carry a UNIQUE constraint
-- (migrations/0001_initial.sql), so the second insert of a colliding pair
-- fails outright with a hard DB error rather than silently duplicating --
-- but that's a visible outage for a citizen/officer, not a fix.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in registrations/repo.ts's nextApplicationNumber and
-- permits/repo.ts's nextPermitNumber, called via nextval() from inside the
-- same transaction that inserts the row): one Postgres SEQUENCE per number
-- type, replacing Date.now() % 999999. Same fix shape as vendor-service's
-- identical bug (see services/vendor-service/migrations/
-- 0002_number_sequences.sql) and animal-service's/inspection-service's
-- before that.
--
-- Ownership: shop-service's migrations run as shop_svc itself
-- (infra/db/bootstrap/bootstrap_shop.sql: "CREATE DATABASE civitas_shop
-- OWNER shop_svc"), and shop_svc owns the `shop` schema it created in
-- 0001_initial.sql -- a sequence created here needs no separate grant,
-- exactly like every table in this schema already.
--
-- Seeding: setval() to one past the highest existing trailing number, so a
-- table that already has rows can't hand out a number that collides with
-- one already in use. GREATEST(1, ...) keeps the seed >= 1 (default
-- sequences have MINVALUE 1); an empty table (MAX IS NULL) seeds at 1,
-- identical to a fresh `START 1` sequence's first nextval().
--
-- Scope: GLOBAL sequences, not per-tenant -- matches the counters they
-- replace, which took no tenant argument (every call site invokes
-- generateApplicationNumber("ULB", ...) / generatePermitNumber("ULB", ...)
-- with the same literal "ULB" short code regardless of tenant).
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS shop.application_number_seq;
--   DROP SEQUENCE IF EXISTS shop.permit_number_seq;
-- Affected services: shop-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS shop.application_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS shop.permit_number_seq START 1;

SELECT setval('shop.application_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(application_number, '(\d+)$'))[1]::bigint)
              FROM shop.applications), 0) + 1), false);
SELECT setval('shop.permit_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(permit_number, '(\d+)$'))[1]::bigint)
              FROM shop.permits), 0) + 1), false);
