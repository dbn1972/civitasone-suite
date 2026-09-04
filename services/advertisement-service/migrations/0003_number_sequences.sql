-- Purpose: Replace collision-prone Date.now() % 999999 sequence generation
-- for application/permit/violation reference numbers with real Postgres
-- SEQUENCEs.
--
-- BUG: applications/consumer.ts, permits/consumer.ts and
-- enforcement/consumer.ts each computed their record's human-facing
-- reference number as `Date.now() % 999999`, called OUTSIDE any lock, once
-- per message, before the write transaction. Two commands processed close
-- enough together (well within reach in practice: multiple officers acting
-- around the same time, or any multi-replica worker deployment) compute
-- IDENTICAL sequence numbers and therefore identical application_number /
-- permit_number / violation_number values. All three columns are UNIQUE
-- (application_number, permit_number: enforced since
-- migrations/0001_initial.sql; violation_number: enforced by this branch's
-- own migrations/0002_enforcement_schema.sql), so the second colliding
-- write's INSERT throws inside its consumer transaction — the whole
-- transaction (including markProcessed) rolls back, so from the citizen's/
-- officer's perspective the command was already 202-accepted and then
-- silently never applied, with no automatic retry.
--
-- Same repo-wide anti-pattern already fixed for inspection-service's
-- encroachment/illegal-construction reference numbers (migration
-- services/inspection-service/migrations/0028_encroachment_illegal_construction_number_sequences.sql,
-- PR #854): replace the in-process expression with a real Postgres SEQUENCE,
-- pulled via nextval() inside the same transaction the consumer is already
-- in. Global sequences, not per-tenant — the code being replaced took no
-- tenant argument at all (every call site passes the hardcoded literal
-- "ULB"), so this preserves that exact scoping.
--
-- Seeding: expected to run against a fresh database in CI, but seeded
-- defensively from any pre-existing rows' trailing digits anyway (same
-- approach PR #854 used) — a bare `CREATE SEQUENCE ... START 1` would
-- otherwise reproduce an already-used number on its very first nextval()
-- and hit the UNIQUE constraint as a hard failure on the first insert after
-- this migration ships, instead of actually fixing anything. An empty table
-- leaves each sequence at its default start (1), identical to a fresh
-- install.
--
-- Rollback:
--   DROP SEQUENCE IF EXISTS adv_applications.application_number_seq;
--   DROP SEQUENCE IF EXISTS adv_permits.permit_number_seq;
--   DROP SEQUENCE IF EXISTS adv_enforcement.violation_number_seq;

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS adv_applications.application_number_seq;
CREATE SEQUENCE IF NOT EXISTS adv_permits.permit_number_seq;
CREATE SEQUENCE IF NOT EXISTS adv_enforcement.violation_number_seq;

DO $$
DECLARE
  max_seq bigint;
BEGIN
  SELECT COALESCE(MAX(substring(application_number FROM '(\d+)$')::bigint), 0)
    INTO max_seq
    FROM adv_applications.adv_applications;
  IF max_seq > 0 THEN
    PERFORM setval('adv_applications.application_number_seq', max_seq + 1, false);
  END IF;
END $$;

DO $$
DECLARE
  max_seq bigint;
BEGIN
  SELECT COALESCE(MAX(substring(permit_number FROM '(\d+)$')::bigint), 0)
    INTO max_seq
    FROM adv_permits.adv_permits;
  IF max_seq > 0 THEN
    PERFORM setval('adv_permits.permit_number_seq', max_seq + 1, false);
  END IF;
END $$;

DO $$
DECLARE
  max_seq bigint;
BEGIN
  SELECT COALESCE(MAX(substring(violation_number FROM '(\d+)$')::bigint), 0)
    INTO max_seq
    FROM adv_enforcement.adv_violations;
  IF max_seq > 0 THEN
    PERFORM setval('adv_enforcement.violation_number_seq', max_seq + 1, false);
  END IF;
END $$;
