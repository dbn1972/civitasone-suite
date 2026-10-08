-- Purpose: GAP2-WORKS-BILLING-08 — add the mandatory record-provenance audit
--          columns (created_by, created_at, updated_at, updated_by) required by
--          CLAUDE.md rule 6 to the billing entities that were missing them:
--          works.measurement_books, works.measurements, works.bill_items,
--          works.bill_recoveries. These underpin financial bills, so
--          record-level provenance matters. Additive + idempotent.
-- Rollback:
--   ALTER TABLE works.measurement_books DROP COLUMN IF EXISTS updated_by,
--     DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE works.measurements    DROP COLUMN IF EXISTS created_by,
--     DROP COLUMN IF EXISTS created_at, DROP COLUMN IF EXISTS updated_by,
--     DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE works.bill_items      DROP COLUMN IF EXISTS created_by,
--     DROP COLUMN IF EXISTS created_at, DROP COLUMN IF EXISTS updated_by,
--     DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE works.bill_recoveries DROP COLUMN IF EXISTS created_by,
--     DROP COLUMN IF EXISTS created_at, DROP COLUMN IF EXISTS updated_by,
--     DROP COLUMN IF EXISTS updated_at;
-- Affected services: works-service

SET lock_timeout = '5s';

-- measurement_books already carries issued_by/issued_at; add created_at (as a
-- backfill from issued_at where present), updated_at, updated_by. Backfill
-- existing rows: created_at defaults to the issued_at that already records
-- when the MB was created, so provenance is correct for historical rows.
ALTER TABLE works.measurement_books
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;
-- Backfill created_by/created_at from the existing issued_by/issued_at so the
-- new columns are not left null on historical rows.
UPDATE works.measurement_books
  SET created_by = COALESCE(created_by, issued_by),
      created_at = COALESCE(created_at, issued_at)
  WHERE created_by IS NULL OR created_at IS NULL;

ALTER TABLE works.measurements
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE works.bill_items
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE works.bill_recoveries
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- New columns inherit the tables' existing grants and RLS policies (set in
-- 0007/0010); no new GRANT or policy is required.
