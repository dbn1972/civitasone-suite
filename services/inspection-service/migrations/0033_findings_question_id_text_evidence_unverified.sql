-- Migration: 0033_findings_question_id_text_evidence_unverified.sql
-- UAT FQ9 #24 and #25. Idempotent and guarded; safe to re-run.
--
-- #24 findings.findings.question_id: 0009 created it as UUID, but the value it references is a
--     checklist question id, which the checklist consumer generates as "q-{section}-{question}"
--     (e.g. "q-1-1") inside the template's JSONB — never a UUID. The Drizzle schema already declares
--     the column as text. Every finding that named its question therefore dead-lettered with
--     `invalid input syntax for type uuid`. Widen the column to text (lossless: uuid::text). It stays
--     nullable — a finding need not be tied to a question.
-- #25 evidence.evidence_artifacts.integrity_status: 0007's CHECK admits only valid|tampered, but the
--     verify-integrity consumer records "unverified" whenever the stored object cannot be re-hashed
--     (storage unconfigured or object unretrievable) — by design it never claims "valid" without
--     proof (evidence/domain.ts decideIntegrity). Every such verify died on the CHECK. Admit
--     'unverified'; no existing row changes.
-- Rollback:
--   ALTER TABLE findings.findings ALTER COLUMN question_id TYPE uuid USING question_id::uuid;  -- only if every value is a uuid
--   ALTER TABLE evidence.evidence_artifacts DROP CONSTRAINT IF EXISTS evidence_artifacts_integrity_status_check;
--   ALTER TABLE evidence.evidence_artifacts ADD CONSTRAINT evidence_artifacts_integrity_status_check
--     CHECK (integrity_status IN ('valid', 'tampered'));  -- only after no row is 'unverified'

SET lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'findings' AND table_name = 'findings'
       AND column_name = 'question_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE findings.findings ALTER COLUMN question_id TYPE text USING question_id::text;
  END IF;
END $$;

-- Drop + re-add in ONE statement (DO block): a lock timeout or any error rolls both back, so the
-- table is never left without the CHECK (migrate-all runs psql without --single-transaction).
-- Added NOT VALID, then validated in a guarded sub-block: a violating existing row leaves it
-- NOT VALID (still enforced for new writes) with a NOTICE instead of failing.
DO $$
BEGIN
  ALTER TABLE evidence.evidence_artifacts DROP CONSTRAINT IF EXISTS evidence_artifacts_integrity_status_check;
  ALTER TABLE evidence.evidence_artifacts
    ADD CONSTRAINT evidence_artifacts_integrity_status_check
    CHECK (integrity_status IN ('valid', 'tampered', 'unverified'))
    NOT VALID;
  BEGIN
    ALTER TABLE evidence.evidence_artifacts VALIDATE CONSTRAINT evidence_artifacts_integrity_status_check;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'evidence_artifacts_integrity_status_check left NOT VALID: existing rows violate it (%)', SQLERRM;
  END;
END $$;
