-- Purpose: Close a duplicate-reference-number bug found during hardening
-- review of applications/consumer.ts and nocs/consumer.ts: both used
-- `randomInt(1, 999999)` to pick the trailing digits of the human-facing
-- application_number / noc_number (see applications/domain.ts's
-- generateApplicationNumber and nocs/domain.ts's generateNocNumber). Both
-- consumers' own comments already flagged this as "Mitigation, not a full
-- fix" -- randomInt is a real improvement over the Date.now() % 999999
-- pattern found and fixed fleet-wide in this same hardening pass (it isn't
-- periodic), but it is still a birthday-paradox collision against a
-- globally-unique column: at moderate volume (~1000 applications/NOCs filed
-- in a year for one tenant), the chance of at least one collision among
-- random draws from a ~999999-value space is non-trivial, and every
-- collision is a hard DB UNIQUE-constraint failure surfaced to a citizen or
-- officer as an opaque 500, not a graceful retry.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in applications/repo.ts's nextApplicationNumber and
-- nocs/repo.ts's nextNocNumber, called via nextval() from inside the same
-- transaction that inserts the row): one Postgres SEQUENCE per number type,
-- replacing randomInt(1, 999999). Same fix shape as animal-service's
-- identical bug (services/animal-service/migrations/
-- 0002_number_sequences.sql, PR #1007) and inspection-service's original
-- (services/inspection-service/migrations/
-- 0028_encroachment_illegal_construction_number_sequences.sql), adapted to
-- this service's ownership model: fire-service's migrations run as
-- fire_svc itself -- fire_svc is the OWNER of civitas_fire (see
-- infra/db/bootstrap/bootstrap_sec5_batch3.sql) and of the
-- fire_applications / fire_nocs schemas it created in 0001_initial.sql. A
-- sequence created here therefore needs no separate grant: it's owned by
-- fire_svc exactly like every table in these schemas already is.
--
-- Seeding: setval() to one past the highest existing trailing number, so a
-- database that already has rows can't hand out a number that collides with
-- one already in use. GREATEST(1, ...) keeps the seed >= 1 (default
-- sequences have MINVALUE 1); an empty table (MAX IS NULL) seeds at 1,
-- identical to a fresh `START 1` sequence's first nextval().
--
-- Scope: GLOBAL sequences, not per-tenant -- matches the counters they
-- replace, which took no tenant argument (every call site invokes
-- generateApplicationNumber("ULB", ...) / generateNocNumber("ULB", ...)
-- with the same literal "ULB" short code regardless of tenant). No BRD note
-- found in this service names a per-tenant numbering requirement.
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS fire_applications.application_number_seq;
--   DROP SEQUENCE IF EXISTS fire_nocs.noc_number_seq;
-- Affected services: fire-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS fire_applications.application_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS fire_nocs.noc_number_seq START 1;

SELECT setval('fire_applications.application_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(application_number, '(\d+)$'))[1]::bigint)
              FROM fire_applications.fire_applications), 0) + 1), false);
SELECT setval('fire_nocs.noc_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(noc_number, '(\d+)$'))[1]::bigint)
              FROM fire_nocs.fire_nocs), 0) + 1), false);
