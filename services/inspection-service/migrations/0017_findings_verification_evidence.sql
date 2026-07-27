-- 0017_findings_verification_evidence.sql
--
-- Purpose: add the missing `findings.findings.verification_evidence` column.
--
-- DEFECT THIS FIXES
-- `src/modules/findings/schema.ts:39` declares
--     verificationEvidence: jsonb("verification_evidence")
-- and `consumer.ts` writes to it, but no migration ever created the column. Any
-- SELECT built from the Drizzle model therefore failed at runtime:
--     PostgresError: column "verification_evidence" does not exist
-- GET /api/v1/inspection/findings returned 500. The table has
-- `verification_notes` but not `verification_evidence` — they are different
-- columns, so this is a genuine omission, not a rename.
--
-- Found 2026-07-27 while extending L1/L2/L4 to inspection-service after bringing
-- it up. It had been latent because the service had never run: no database, no
-- role, so nothing ever executed the query.
--
-- Guarded against recurrence by scripts/ci/schema-drift-guard.mjs, which
-- compares every Drizzle column declaration against the live database.
--
-- Rollback:
--   ALTER TABLE findings.findings DROP COLUMN IF EXISTS verification_evidence;
--
-- Affected services: inspection-service (findings module)
-- Additive and nullable, so no backfill is required and existing rows are valid.

SET lock_timeout = '5s';

ALTER TABLE findings.findings
  ADD COLUMN IF NOT EXISTS verification_evidence jsonb;

COMMENT ON COLUMN findings.findings.verification_evidence IS
  'Verification evidence payload: { evidenceIds: string[], notes: string }. Distinct from verification_notes, which holds free text only.';
