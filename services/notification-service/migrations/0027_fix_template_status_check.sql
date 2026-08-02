-- ============================================================================
-- 0027_fix_template_status_check.sql
--
-- PURPOSE
--   Repairs a latent defect that makes the ENTIRE template approval workflow
--   impossible to persist. Not a new feature — a correctness fix.
--
--   Migration 0008 created (see 0008 lines 50-52 — added NOT VALID, then
--   VALIDATEd at line 61):
--     templates_status_check  CHECK (status IN ('active','superseded'))
--
--   Migration 0020 added the approval-workflow columns and INTENDED to widen
--   that constraint to admit the workflow states. It did:
--     ALTER TABLE templates.templates DROP CONSTRAINT IF EXISTS chk_template_status;
--     ALTER TABLE templates.templates ADD  CONSTRAINT chk_template_status
--       CHECK (status IN ('draft','in_review','approved','published','active','archived'));
--
--   The DROP names `chk_template_status`, which did not exist at that point —
--   the constraint actually in the way was 0008's `templates_status_check`. The
--   IF EXISTS made the mistake silent. Both constraints therefore now coexist,
--   and CHECK constraints are ANDed, so the effective admissible set is the
--   INTERSECTION:
--     {active,superseded} ∩ {draft,in_review,approved,published,active,archived}
--       = {active}
--
--   So the column admitted exactly ONE value. Not a narrowed workflow — no
--   workflow at all, and 'archived' was collateral damage alongside the four
--   approval states.
--
--   Consequence: approval/consumer.ts calls updateTemplateStatus() with
--   'in_review' / 'approved' / 'draft' / 'published'. Every one of those writes
--   is rejected by templates_status_check, so submit / approve / reject /
--   publish have never been able to complete against a migrated database.
--   Verified directly:
--     INSERT ... status='in_review'
--       ERROR: new row for relation "templates" violates check constraint
--              "templates_status_check"
--
--   This migration drops the stale, superseded constraint, which is what 0020
--   meant to do. `chk_template_status` remains and continues to enforce the
--   full valid set, so status stays constrained — the column is NOT left open.
--
-- WHY DROPPING THIS CONSTRAINT IS SAFE
--   * It is a CHECK constraint, not a table or column. The no-destructive-ops
--     rule forbids DROP TABLE / DROP COLUMN / destructive ALTER TYPE; removing a
--     redundant CHECK is none of those and destroys no data.
--   * It only ever WIDENS what is admissible, so no existing row can be
--     invalidated and no application read path changes.
--   * 'superseded' is the one value permitted by the old constraint and not by
--     the surviving one. No row can currently hold it: 0020 added
--     chk_template_status as a validated (non-NOT VALID) constraint, which would
--     have failed outright had any 'superseded' row existed. Confirmed on the dev
--     database — all 17 rows are 'active', none 'superseded'.
--     Before deploying to an environment with real data, re-run:
--       SELECT status, count(*) FROM templates.templates GROUP BY status;
--     and confirm no row is 'superseded'. If any is, that row must be migrated to
--     'archived' first, in a separate data migration.
--   * Idempotent: DROP CONSTRAINT IF EXISTS, wrapped in a guard so re-running is
--     a no-op.
--
-- ROLLBACK
--   Re-adding the old constraint would re-break the approval workflow, so this
--   is intentionally one-way. If it must be reversed, first confirm no template
--   sits in a workflow state, then:
--     SET lock_timeout = '5s';
--     ALTER TABLE templates.templates
--       ADD CONSTRAINT templates_status_check
--       CHECK (status IN ('active','superseded'));
--   Reversing this reinstates the defect described above. Requires tech-lead
--   approval per the no-destructive-operations rule.
--
-- AFFECTED SERVICES
--   notification-service   approval module (submit/approve/reject/publish),
--                          templates repo updateTemplateStatus()
--   workflow-service       maker-checker approvals on notification templates
--   audit-service          consumes the audit events those transitions emit
--
-- SAFETY
--   Idempotent and non-destructive. No index build, so no CONCURRENTLY concern.
-- ============================================================================

SET lock_timeout = '5s';

DO $$
BEGIN
  -- Guarded rather than a bare DROP ... IF EXISTS so the intent is explicit and
  -- the notice below explains the change in migration logs.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'templates_status_check'
      AND conrelid = 'templates.templates'::regclass
  ) THEN
    ALTER TABLE templates.templates DROP CONSTRAINT templates_status_check;
    RAISE NOTICE
      'dropped stale templates_status_check; chk_template_status now solely governs templates.status';
  END IF;
END
$$;

-- Belt and braces: 0020 added chk_template_status, but a database that somehow
-- skipped it would end up with NO constraint on status once the above runs.
-- Re-assert it here so status is constrained on every path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_template_status'
      AND conrelid = 'templates.templates'::regclass
  ) THEN
    ALTER TABLE templates.templates
      ADD CONSTRAINT chk_template_status
      CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'active', 'archived'));
  END IF;
END
$$;
