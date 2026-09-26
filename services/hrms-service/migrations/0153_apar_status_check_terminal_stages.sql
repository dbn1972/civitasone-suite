-- 0153_apar_status_check_terminal_stages.sql
--
-- CRITICAL fix: appraisal.hrms_appraisals_status_check does not allow the
-- three APAR-specific terminal stages the application actually writes, so
-- POST /v1/hrms/apar/:id/accept -- and everything chained after it -- is
-- permanently broken.
--
-- Proof: the route (apar/routes.ts) answers 200 immediately with a
-- plausible-looking body (e.g. {"status":"disclosed","overallGrade":8,
-- "band":"Very Good"}) because it only *publishes* an async f3RouteWrite
-- command (shared/f3-publish.ts's publishF3Write) and returns a synthesized
-- response -- the real write happens later, in apar/f3-consumer.ts's
-- registerF3_apar_Consumers, inside db.transaction(). That write throws,
-- every time, with:
--   PostgresError: new row for relation "hrms_appraisals" violates check
--   constraint "hrms_appraisals_status_check"
-- from op apar_routes__4 (the accept handler) -- caught, logged
-- (log.error({ err, op, messageId }, "f3RouteWrite failed")) and re-thrown,
-- but the HTTP caller already received its 200 and never learns the row
-- never moved. status stays 'accepting_authority' forever; overall_grade /
-- overall_band stay NULL forever. representation and finalise then
-- correctly 409 WRONG_STAGE, since the row genuinely never left
-- accepting_authority -- a downstream symptom of this same root cause, not
-- a separate bug.
--
-- ============================================================================
-- Root cause: schema drift across three migrations touching one constraint
-- ============================================================================
-- 0017_apar_workflow.sql (the migration that introduced the APAR module)
-- correctly widened the constraint to all 10 stages the two modules that
-- share this table use:
--   CHECK (status IN (
--     'pending','in_review','completed',
--     'self_pending','reporting_officer','reviewing_officer','accepting_authority',
--     'disclosed','representation','finalised'
--   ))
--
-- 0027_apar_rls_completion.sql then re-applied the constraint idempotently,
-- purely to resolve an unrelated 0011-prefix filename collision
-- (0011_ai_fraud_detection.sql vs 0011_apar_status_check.sql -- see that
-- migration's own header for the full story). Its stated intent was only to
-- guarantee *some* version of the APAR check was present in every
-- environment, but the CHECK it re-applied was copied from the pre-0017
-- 7-value list, not 0017's already-widened 10-value one -- silently
-- narrowing the constraint back down and dropping 'disclosed' /
-- 'representation' / 'finalised' again:
--   CHECK (status IN ('pending','in_review','completed','self_pending',
--                     'reporting_officer','reviewing_officer','accepting_authority'))
--
-- 0111_apar_status_check.sql ("was 500ing every APAR write") re-aligned the
-- constraint again for an unrelated reason, but was written against the
-- THEN-current (already regressed by 0027) 7-value definition, so it
-- perpetuated the exact same gap instead of closing it.
--
-- ============================================================================
-- Exhaustive grep: every literal value ever written to this column
-- ============================================================================
-- apar/f3-consumer.ts (registerF3_apar_Consumers -- the ONLY writer for the
-- APAR module; apar/routes.ts itself never touches the DB, it only
-- publishes via shared/f3-publish.ts's publishF3Write):
--   apar_routes__0 -> 'self_pending'        (INSERT, new APAR)
--   apar_routes__1 -> 'reporting_officer'
--   apar_routes__2 -> 'reviewing_officer'
--   apar_routes__3 -> 'accepting_authority'
--   apar_routes__4 -> 'disclosed'           *** missing from 0111 ***
--   apar_routes__5 -> 'representation'      *** missing from 0111 ***
--   apar_routes__6 -> 'finalised'           *** missing from 0111 ***
--
-- appraisals/consumer.ts (the sibling generic-appraisals module, sharing
-- this SAME table -- see appraisals/routes.ts's own header comment, which
-- explicitly documents that both modules write hrms_appraisals.status):
--   create      -> p.status ?? 'self_pending'
--   PATCH stage -> p.stage, but assertAppraisalStageOwner only ever lets a
--     caller advance to the SINGLE next value in APPRAISAL_STAGES =
--     ['self_pending','reporting_officer','reviewing_officer',
--     'accepting_authority','completed'] -- no value outside that closed
--     list can ever reach the DB from this module.
--
-- appraisals/schema.ts's column default is 'pending' (the original,
-- pre-APAR vocabulary). migrations/0003_appraisals_regularisations.sql is
-- where 'pending' / 'in_review' / 'completed' originate; tests/fixtures/
-- core-seed.ts still seeds rows with 'in_review' and 'completed'.
--
-- Union of every value above: pending, in_review, completed, self_pending,
-- reporting_officer, reviewing_officer, accepting_authority, disclosed,
-- representation, finalised -- 10 values, exactly 0017's original list.
-- The current (0111) constraint allows only the first 7; this migration
-- adds back the missing 3. No other value is written anywhere in the repo.
--
-- ============================================================================
-- Fix
-- ============================================================================
-- Same NOT VALID + VALIDATE CONSTRAINT pattern as
-- services/payroll-service/migrations/0047_fix_payroll_status_check_constraints.sql,
-- so a table that has accumulated a meaningful number of rows is never
-- locked for a full validation scan -- only briefly for the DROP and the
-- ADD CONSTRAINT ... NOT VALID (no data scan). VALIDATE CONSTRAINT then
-- takes just a SHARE UPDATE EXCLUSIVE lock and runs concurrently with
-- ordinary reads/writes. This is a pure widening: every status value any
-- writer produces today already satisfies the new, larger list.
--
-- ----------------------------------------------------------------------------
-- Rollback (documented for symmetry with 0047; reverting reintroduces this
-- exact defect and should not be done):
--   ALTER TABLE appraisal.hrms_appraisals DROP CONSTRAINT IF EXISTS hrms_appraisals_status_check;
--   ALTER TABLE appraisal.hrms_appraisals ADD CONSTRAINT hrms_appraisals_status_check
--     CHECK (status IN ('pending','in_review','completed','self_pending',
--                       'reporting_officer','reviewing_officer','accepting_authority'));
-- ----------------------------------------------------------------------------

SET lock_timeout = '5s';

ALTER TABLE appraisal.hrms_appraisals
  DROP CONSTRAINT IF EXISTS hrms_appraisals_status_check;

DO $$ BEGIN
  ALTER TABLE appraisal.hrms_appraisals
    ADD CONSTRAINT hrms_appraisals_status_check
    CHECK (status IN (
      'pending', 'in_review', 'completed',
      'self_pending', 'reporting_officer', 'reviewing_officer', 'accepting_authority',
      'disclosed', 'representation', 'finalised'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE appraisal.hrms_appraisals
  VALIDATE CONSTRAINT hrms_appraisals_status_check;
