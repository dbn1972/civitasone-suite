-- FQ12 (#57): PATCH /v1/audit/vigilance/:id/screen accepts `remarks`, but the
-- consumer had no column to write them to and dropped them. Nullable text column,
-- no backfill (earlier remarks were never stored). Idempotent.
-- Rollback: ALTER TABLE vigilance.vigilance_cases DROP COLUMN IF EXISTS screening_remarks;
ALTER TABLE vigilance.vigilance_cases ADD COLUMN IF NOT EXISTS screening_remarks text;
