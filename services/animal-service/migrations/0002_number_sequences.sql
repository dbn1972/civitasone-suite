-- Purpose: Close a duplicate-reference-number bug found during hardening
-- review of complaints/consumer.ts and registration/consumer.ts: both used
-- `Date.now() % 999999` to pick the trailing digits of the human-facing
-- complaint_number / registration_number (see complaints/domain.ts's
-- generateComplaintNumber and registration/domain.ts's
-- generateRegistrationNumber). Date.now() % 999999 is periodic on
-- ~999999ms (~16.7 minutes), so any two commands processed ~16.7 minutes
-- apart (or any multiple thereof) reserve the identical number -- a real
-- collision under normal load, not a theoretical one. Both columns already
-- carry a UNIQUE constraint (migrations/0001_initial.sql), so the second
-- insert of a colliding pair fails outright with a hard DB error rather than
-- silently duplicating -- but that's a visible outage for a citizen/officer,
-- not a fix.
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in complaints/repo.ts's nextComplaintNumber and
-- registration/repo.ts's nextRegistrationNumber, called via nextval() from
-- inside the same transaction that inserts the row): one Postgres SEQUENCE
-- per number type, replacing Date.now() % 999999. Same fix shape as
-- inspection-service's identical bug (see services/inspection-service/
-- migrations/0028_encroachment_illegal_construction_number_sequences.sql),
-- adapted to this service's ownership model: unlike inspection-service
-- (civitas_admin-owned tables, explicit grants to inspection_svc),
-- animal-service's migrations run as animal_svc itself -- animal_svc is the
-- OWNER of civitas_animal (see infra/db/bootstrap/bootstrap_municipal_
-- services.sql: "CREATE DATABASE civitas_animal OWNER animal_svc") and of
-- the `animal` schema it created in 0001_initial.sql. A sequence created
-- here therefore needs no separate grant: it's owned by animal_svc exactly
-- like every table in this schema already is.
--
-- Seeding: setval() to one past the highest existing trailing number, so a
-- table that already has rows can't hand out a number that collides with
-- one already in use. GREATEST(1, ...) keeps the seed >= 1 (default
-- sequences have MINVALUE 1); an empty table (MAX IS NULL) seeds at 1,
-- identical to a fresh `START 1` sequence's first nextval().
--
-- Scope: GLOBAL sequences, not per-tenant -- matches the counters they
-- replace, which took no tenant argument (every call site invokes
-- generateComplaintNumber("ULB", ...) / generateRegistrationNumber("ULB", ...)
-- with the same literal "ULB" short code regardless of tenant). No BRD note
-- found in this service names a per-tenant numbering requirement.
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS animal.complaint_number_seq;
--   DROP SEQUENCE IF EXISTS animal.registration_number_seq;
-- Affected services: animal-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS animal.complaint_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS animal.registration_number_seq START 1;

SELECT setval('animal.complaint_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(complaint_number, '(\d+)$'))[1]::bigint)
              FROM animal.animal_complaints), 0) + 1), false);
SELECT setval('animal.registration_number_seq',
  GREATEST(1, COALESCE((SELECT MAX((regexp_match(registration_number, '(\d+)$'))[1]::bigint)
              FROM animal.animal_registrations), 0) + 1), false);
