-- 0143_apar_scores_audit_columns.sql
--
-- Purpose: add the missing `created_by` / `updated_by` columns to
-- appraisal.hrms_apar_scores.
--
-- DEFECT THIS FIXES (found while adding a real-DB regression test for the
-- PR #1535 APAR IDOR fix -- unrelated to that fix itself)
-- apar/schema.ts's hrmsAparScores Drizzle table has declared `createdBy`
-- and `updatedBy` as NOT NULL uuid columns since the APAR/SPARROW workflow
-- was first built (apar/repo.ts's upsertScore() has always written both on
-- every insert/update), but no migration ever created them:
-- 0017_apar_workflow.sql's original CREATE TABLE for this table never
-- included them, and no later migration added them (verified:
-- `grep -rl hrms_apar_scores migrations/` turns up only 0017, 0034, 0038,
-- 0123 and 0124, and none of those touch these two columns -- 0124 only
-- adds indexes on this table).
--
-- Effect: every query drizzle issues against this table's `created_by`
-- column fails outright against a genuinely-migrated database with
--
--     error: column "created_by" does not exist
--
-- apar/repo.ts's listScores() is one such query, and GET
-- /v1/hrms/apar/:id calls it (alongside listHistory) for every detail
-- fetch, tenant-wide -- so that endpoint 500s for every caller, HR
-- included, regardless of role or the ownership/IDOR fix this migration
-- ships alongside. Invisible until now because civitas_hrms has had zero
-- rows in hrms_appraisals/hrms_employees (per PR #1535's review), so no
-- real end-to-end GET /:id request had ever actually reached this query.
-- Reproduced by bootstrapping a fresh postgres:16-alpine cluster from this
-- repo's own migrations/ directory end-to-end and hitting a real GET
-- /v1/hrms/apar/:id with a seeded appraisal + score row
-- (tests/apar-identity-resolution.test.ts).
--
-- No backfill needed in any environment checked (civitas_hrms and a fresh
-- bootstrap alike both have zero existing rows in this table), but this
-- defensively backfills from `scored_by` -- the one existing NOT NULL
-- "who acted on this row" column -- for any row that does exist elsewhere,
-- before enforcing NOT NULL. Idempotent / safe to re-run.
ALTER TABLE appraisal.hrms_apar_scores
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

UPDATE appraisal.hrms_apar_scores
   SET created_by = COALESCE(created_by, scored_by),
       updated_by = COALESCE(updated_by, scored_by)
 WHERE created_by IS NULL OR updated_by IS NULL;

ALTER TABLE appraisal.hrms_apar_scores
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN updated_by SET NOT NULL;
