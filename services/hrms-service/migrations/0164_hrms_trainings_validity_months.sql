-- 0164: training.hrms_trainings -- add validity_months (certification expiry basis).
--
-- GAP-HR-CERTIFICATIONS-01: GET /v1/hrms/certifications hard-coded
-- `NULL::date AS "expiryDate", 'valid' AS status` for every row -- expiry
-- tracking (banner, Expiring Soon/Expired stats, red cards, sorting) could
-- never fire against live data. There is an unrelated `validity_months`
-- column on `assessment.assessments` (migration 0043, a separate
-- question-bank/quiz/certificate system), but the certifications query
-- reads from training.hrms_nominations/training.hrms_trainings, which have
-- no validity concept at all -- a genuinely new column, not a case of
-- reusing something already joinable.
--
-- Lives on hrms_trainings (the training *programme*), not hrms_nominations
-- (the per-employee completion record): validity period is a property of
-- the certification/programme itself, mirroring how migration 0162 already
-- added category/mode/enrollment_deadline to this same table.
--
-- Existing rows backfill to NULL, never a fabricated default -- a training
-- programme with no recorded validity has no expiry computed for it
-- (certifications/routes.ts and the web layer must treat NULL as "no expiry
-- tracking configured", never as "valid forever" or a fabricated zero).
ALTER TABLE training.hrms_trainings
  ADD COLUMN IF NOT EXISTS validity_months integer;

-- FIXED 2026-10-01: a bare `ADD CONSTRAINT` has no `IF NOT EXISTS` form in
-- PostgreSQL, so re-running this migration (CI's "Quality Gates -- Schema
-- Integrity (L3)" job bootstraps the full migration set twice) threw
-- `ERROR: constraint "hrms_trainings_validity_months_positive" already
-- exists` on the second pass. Rewritten to the idempotent DO/
-- duplicate_object form already used ~100+ times elsewhere in this repo for
-- this exact bug class (e.g. crm-service/migrations/0083_lead_score_column.sql,
-- admin-service/migrations/0007_check_constraints_status_columns.sql).
DO $$ BEGIN
  ALTER TABLE training.hrms_trainings
    ADD CONSTRAINT hrms_trainings_validity_months_positive
      CHECK (validity_months IS NULL OR validity_months > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
