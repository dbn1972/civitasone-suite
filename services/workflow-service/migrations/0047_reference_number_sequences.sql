-- Purpose: replace the Date.now()/random-suffix human reference numbers with
-- Postgres SEQUENCEs (same defect class as drainage-service #2182: a
-- UNIQUE-violation retry replays the SAME pre-generated value, so an accepted
-- (202) command can be lost for good, and concurrent requests can collide).
--
--   * workflow.cases.case_number      was CASE-<epoch ms>-<6 hex of uuid>   (case-registry/repo.ts)
--                                     and <parent>-<4 hex of uuid> children (case-links/repo.ts)
--   * workflow.definitions.code       was imported_<epoch ms> for BPMN imports (bpmn/routes.ts),
--                                     UNIQUE (tenant_id, code, version)
--
-- The numbers are now allocated with nextval() INSIDE the transaction that
-- inserts the row (src/shared/numbers.ts), so a retry re-allocates and cannot
-- collide. New formats: CASE-YYYY-000123 and BPMN-YYYY-000123 (year in IST).
-- The sequences are GLOBAL (the columns are not tenant-scoped in the number).
--
-- Seeding: one past the highest trailing number of any row ALREADY in the new
-- format (legacy values can never equal a new PREFIX-YYYY-NNNNNN value), and
-- never LOWER than the sequence already is, so a re-run cannot rewind it and
-- re-issue numbers. Additive and idempotent.
--
-- cases.case_number had NO unique constraint at all; a partial UNIQUE index over
-- the new format is added (legacy rows are outside the predicate, so existing
-- data cannot block the migration). definitions keeps UNIQUE (tenant_id, code,
-- version) untouched.
--
-- FORCE RLS: both source tables may be FORCE ROW LEVEL SECURITY and this
-- migration runs as their OWNER with no app.tenant_id GUC, so the read-only
-- cross-tenant MAX() would see ZERO rows and seed the sequences to 1. FORCE is
-- lifted only if it was on, and restored in the same transaction (house rule
-- 4.3 backfill idiom).
-- Rollback:
--   DROP INDEX IF EXISTS workflow.uq_cases_case_number_seqfmt;
--   DROP SEQUENCE IF EXISTS workflow.case_number_seq;
--   DROP SEQUENCE IF EXISTS workflow.definition_import_seq;
-- Affected services: workflow-service

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS workflow.case_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS workflow.definition_import_seq START 1;

DO $seed$
DECLARE
  force_cases bool;
  force_defs  bool;
BEGIN
  SELECT relforcerowsecurity INTO force_cases FROM pg_class WHERE oid = 'workflow.cases'::regclass;
  SELECT relforcerowsecurity INTO force_defs  FROM pg_class WHERE oid = 'workflow.definitions'::regclass;
  IF force_cases THEN ALTER TABLE workflow.cases       NO FORCE ROW LEVEL SECURITY; END IF;
  IF force_defs  THEN ALTER TABLE workflow.definitions NO FORCE ROW LEVEL SECURITY; END IF;

  PERFORM setval('workflow.case_number_seq',
    GREATEST(
      (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM workflow.case_number_seq),
      COALESCE((SELECT MAX((regexp_match(case_number, '^CASE-[0-9]{4}-([0-9]{1,15})$'))[1]::bigint)
                  FROM workflow.cases), 0) + 1), false);
  PERFORM setval('workflow.definition_import_seq',
    GREATEST(
      (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM workflow.definition_import_seq),
      COALESCE((SELECT MAX((regexp_match(code, '^BPMN-[0-9]{4}-([0-9]{1,15})$'))[1]::bigint)
                  FROM workflow.definitions), 0) + 1), false);

  IF force_cases THEN ALTER TABLE workflow.cases       FORCE ROW LEVEL SECURITY; END IF;
  IF force_defs  THEN ALTER TABLE workflow.definitions FORCE ROW LEVEL SECURITY; END IF;
END
$seed$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cases_case_number_seqfmt
  ON workflow.cases (case_number)
  WHERE case_number ~ '^CASE-[0-9]{4}-[0-9]{6,}$';
COMMIT;
