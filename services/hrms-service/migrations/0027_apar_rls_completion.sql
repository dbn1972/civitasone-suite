-- 0027_apar_rls_completion.sql
-- Purpose: (1) Documents and resolves the 0011 migration filename collision.
--          (2) Re-applies the APAR status CHECK idempotently (DROP IF EXISTS +
--              ADD CONSTRAINT) so the constraint is guaranteed present regardless
--              of which 0011 file the runner applied.
--          (3) Adds RLS to appraisal.hrms_appraisals which was omitted from 0026.
--
-- BACKGROUND — 0011 COLLISION:
--   Two files share the prefix "0011":
--     • 0011_ai_fraud_detection.sql   — creates ML fraud-detection tables
--     • 0011_apar_status_check.sql    — adds APAR status CHECK constraint
--   Many migration runners treat the prefix as the migration version, so only
--   one of these files may have been executed.  This migration re-applies the
--   APAR check and any other content from 0011_apar_status_check.sql in a fully
--   idempotent manner, ensuring the constraint is present in all environments.
--
-- Additive + idempotent only — no DROP TABLE, no data changes.

-- ── 1. APAR status CHECK (idempotent re-apply) ────────────────────
-- DROP first so re-running this migration is safe even if the constraint
-- was already added by 0011_apar_status_check.sql in some environments.
ALTER TABLE appraisal.hrms_appraisals
  DROP CONSTRAINT IF EXISTS hrms_appraisals_status_check;

ALTER TABLE appraisal.hrms_appraisals
  ADD CONSTRAINT hrms_appraisals_status_check
  CHECK (status IN (
    'pending',
    'in_review',
    'completed',
    'self_pending',
    'reporting_officer',
    'reviewing_officer',
    'accepting_authority'
  ));

-- ── 2. RLS on appraisal schema ────────────────────────────────────
-- appraisal.hrms_appraisals was missed in 0026_rls_tenant_isolation.sql.
-- employee.current_tenant_id() is created in 0026 and is already available.
ALTER TABLE appraisal.hrms_appraisals ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal.hrms_appraisals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON appraisal.hrms_appraisals;
CREATE POLICY tenant_isolation ON appraisal.hrms_appraisals
  USING (tenant_id = employee.current_tenant_id());
