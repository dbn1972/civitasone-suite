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

-- BACKFILL UNDER FORCE RLS -- read this before touching the UPDATE below.
--
-- 0123_rls_completeness.sql put appraisal.hrms_apar_scores under FORCE ROW LEVEL
-- SECURITY with `tenant_isolation_policy USING/WITH CHECK (tenant_id =
-- employee.current_tenant_id())`, and current_tenant_id() (0034) reads the
-- `app.tenant_id` session GUC, returning NULL when it is unset. FORCE means even
-- the table owner -- hrms_svc, who this migration runs as (SERVICE_DBS in
-- scripts/ci/bootstrap-postgres.sh) -- is subject to that policy, and that
-- script's migration loop is a bare `psql -f` that never sets app.tenant_id.
--
-- Confirmed against a live cluster: with RLS enforced and no GUC set, the plain
-- UPDATE this comment used to sit above silently matches 0 rows (never an error)
-- for any row that exists, so it backfills nothing and the ALTER COLUMN ... SET
-- NOT NULL below then aborts the whole migration with `column "created_by" ...
-- contains null values` -- exactly what happens the moment a real row exists in
-- this table, e.g. once this same PR's write-path fix ships and HR actually
-- scores an APAR.
--
-- A per-tenant `PERFORM set_config('app.tenant_id', ...)` loop (this repo's usual
-- pattern for tenant-scoped seed/backfill DO blocks -- see e.g.
-- services/finance-service/migrations/0004_coa_account_types.sql) does not work
-- here: the natural way to discover WHICH tenants need backfilling --
-- `SELECT DISTINCT tenant_id FROM ... WHERE created_by IS NULL` -- is itself
-- filtered to zero rows by this same FORCE RLS policy before any per-tenant GUC
-- is ever set, so it can never find the rows it would need to loop over.
-- Confirmed empirically (also returns 0 rows against the seeded row above).
--
-- Fix: run the backfill with FORCE lifted, inside ONE transaction. `NO FORCE ROW
-- LEVEL SECURITY` takes an ACCESS EXCLUSIVE lock on the table (verified against a
-- live cluster) that this transaction holds until COMMIT, so no concurrent
-- session can ever observe the table in its briefly-unforced state -- anything
-- else touching this table just queues behind the lock until FORCE is already
-- restored below and this transaction commits. hrms_svc (table owner) is exempt
-- from RLS while not forced, same as any other owner-run maintenance statement,
-- and the same rollback primitive 0016_force_rls_inspection_domain.sql already
-- documents for this repo's other FORCE-RLS migrations. Idempotent / safe to
-- re-run: on a re-run every row already has created_by/updated_by set, so the
-- UPDATE's WHERE clause matches nothing.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE appraisal.hrms_apar_scores NO FORCE ROW LEVEL SECURITY;

UPDATE appraisal.hrms_apar_scores
   SET created_by = COALESCE(created_by, scored_by),
       updated_by = COALESCE(updated_by, scored_by)
 WHERE created_by IS NULL OR updated_by IS NULL;

ALTER TABLE appraisal.hrms_apar_scores FORCE ROW LEVEL SECURITY;
COMMIT;

ALTER TABLE appraisal.hrms_apar_scores
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN updated_by SET NOT NULL;
