-- Purpose: Close a duplicate-reference-number bug found during hardening
-- review of applications/consumer.ts and permits/consumer.ts: both used
-- `Date.now() % 999999` to pick the trailing digits of the human-facing
-- application_number / permit_number (see applications/domain.ts's
-- generateApplicationNumber and permits/domain.ts's generatePermitNumber).
-- Date.now() % 999999 is PERIODIC, not random -- two commands processed in
-- the same millisecond (a real possibility for concurrent consumer
-- processing, and certain for anything issued via retried/duplicate
-- publishes) collide deterministically, not just probabilistically. Every
-- collision is a hard DB UNIQUE-constraint failure surfaced as a permanently
-- stuck message (the consumer's transaction never commits, so the outbox
-- message effectively poison-pills) rather than a graceful retry.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in applications/repo.ts's nextApplicationNumber and
-- permits/repo.ts's nextPermitNumber, called via nextval() from inside the
-- same transaction that inserts the row): one Postgres SEQUENCE per number
-- type, replacing Date.now() % 999999. Same fix shape as animal-service's
-- identical bug class (services/animal-service/migrations/
-- 0002_number_sequences.sql, PR #1007) and fire-service's (services/
-- fire-service/migrations/0002_number_sequences.sql, PR #1011), adapted to
-- this service's ownership model: roadcut-service's migrations run as
-- roadcut_svc itself -- roadcut_svc is the OWNER of the roadcut schema (see
-- infra/db/bootstrap/bootstrap_municipal_services.sql) and of every table in
-- it created in 0001_initial.sql. A sequence created here therefore needs no
-- separate grant: it's owned by roadcut_svc exactly like every table in this
-- schema already is.
--
-- Seeding: setval() to one past the highest existing trailing number, so a
-- database that already has rows can't hand out a number that collides with
-- one already in use. GREATEST(1, ...) keeps the seed >= 1 (default
-- sequences have MINVALUE 1); an empty table (MAX IS NULL) seeds at 1,
-- identical to a fresh `START 1` sequence's first nextval().
--
-- Scope: GLOBAL sequences, not per-tenant -- matches the counters they
-- replace, which took no tenant argument (every call site invokes
-- generateApplicationNumber("ULB", ...) / generatePermitNumber("ULB", ...)
-- with the same literal "ULB" short code regardless of tenant). No BRD note
-- found in this service names a per-tenant numbering requirement.
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS roadcut.application_number_seq;
--   DROP SEQUENCE IF EXISTS roadcut.permit_number_seq;
-- Affected services: roadcut-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS roadcut.application_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS roadcut.permit_number_seq START 1;

SELECT setval('roadcut.application_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(application_number, '(\d+)$'))[1]::bigint)
              FROM roadcut.roadcut_applications), 0) + 1), false);
SELECT setval('roadcut.permit_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(permit_number, '(\d+)$'))[1]::bigint)
              FROM roadcut.roadcut_permits), 0) + 1), false);
