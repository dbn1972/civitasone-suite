-- Purpose: G1/G2 governance guards, enforced at the DATABASE rather than only in the
--   application, plus the version uniqueness that makes "versioned by row" a constraint
--   instead of a convention.
--
--   1. uq_journey_templates_version — one row per (tenant, template_key, version_number).
--      Without it two concurrent publishes could both insert "version 3".
--
--   2. crm.guard_canonical_stage_vocabulary() — refuses UPDATE/DELETE of a
--      governance='canonical' stage_vocabulary row. The route already answers 422
--      (STAGE_CODE_CANONICAL) before publishing a command, but a route check only binds
--      callers who go through the route. G1's whole point is a vocabulary that cannot be
--      renamed by a tenant, so the last word belongs to the table.
--
--   3. crm.guard_published_journey_template() — refuses an in-place change to the `steps`
--      of a published or deprecated template. Historical journey instances reference a
--      template row id; rewriting its steps would silently change what those instances
--      mean. Status transitions (publish / deprecate / soft-delete) stay allowed.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_guard_canonical_stage_vocabulary_update ON crm.stage_vocabulary;
--   DROP TRIGGER IF EXISTS trg_guard_canonical_stage_vocabulary_delete ON crm.stage_vocabulary;
--   DROP TRIGGER IF EXISTS trg_guard_published_journey_template ON crm.journey_templates;
--   DROP FUNCTION IF EXISTS crm.guard_canonical_stage_vocabulary();
--   DROP FUNCTION IF EXISTS crm.guard_published_journey_template();
--   DROP INDEX IF EXISTS crm.uq_journey_templates_version;
--
--   NOTE for a future migration that legitimately needs to evolve the national
--   vocabulary: drop trigger (1)/(2) explicitly in that migration, apply the change, then
--   recreate them. There is deliberately no session-variable escape hatch — a bypass the
--   service could set would put immutability back in the application's gift.
--
-- Affected services: crm-service (journeys module)
-- Sequencing: additive — one unique index and two trigger functions. No data change.

SET lock_timeout = '5s';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_journey_templates_version
  ON crm.journey_templates (tenant_id, template_key, version_number);

CREATE OR REPLACE FUNCTION crm.guard_canonical_stage_vocabulary()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.governance = 'canonical' THEN
    RAISE EXCEPTION
      'CANONICAL_IMMUTABLE: stage_vocabulary row % (stage_code=%) is canonical and cannot be % ',
      OLD.id, OLD.stage_code, lower(TG_OP)
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

DO $t$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_canonical_stage_vocabulary_update'
      AND tgrelid = 'crm.stage_vocabulary'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_canonical_stage_vocabulary_update
      BEFORE UPDATE ON crm.stage_vocabulary
      FOR EACH ROW EXECUTE FUNCTION crm.guard_canonical_stage_vocabulary();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_canonical_stage_vocabulary_delete'
      AND tgrelid = 'crm.stage_vocabulary'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_canonical_stage_vocabulary_delete
      BEFORE DELETE ON crm.stage_vocabulary
      FOR EACH ROW EXECUTE FUNCTION crm.guard_canonical_stage_vocabulary();
  END IF;
END $t$;

CREATE OR REPLACE FUNCTION crm.guard_published_journey_template()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.status IN ('published', 'deprecated') AND NEW.steps IS DISTINCT FROM OLD.steps THEN
    RAISE EXCEPTION
      'TEMPLATE_IMMUTABLE: journey_template % is % ; publish a new version instead of editing its steps',
      OLD.id, OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

DO $t$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_published_journey_template'
      AND tgrelid = 'crm.journey_templates'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_published_journey_template
      BEFORE UPDATE ON crm.journey_templates
      FOR EACH ROW EXECUTE FUNCTION crm.guard_published_journey_template();
  END IF;
END $t$;
