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

-- measurement_books already carries issued_by/issued_at. created_at is added
-- NULLABLE first (a NOT NULL DEFAULT now() column would be filled with the
-- migration timestamp, making any COALESCE(created_at, issued_at) backfill a
-- silent no-op and recording wrong provenance for historical rows), backfilled
-- from issued_at / issued_by, and only then tightened to NOT NULL DEFAULT now().
ALTER TABLE works.measurement_books
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- The backfill is DML on a FORCE-RLS table (0010). An owner-run migration has
-- no app.tenant_id GUC, so under FORCE RLS the UPDATE would match 0 rows.
-- Wrap it in NO FORCE / FORCE (repo rule); FORCE is restored unconditionally.
ALTER TABLE works.measurement_books NO FORCE ROW LEVEL SECURITY;
UPDATE works.measurement_books
  SET created_by = COALESCE(created_by, issued_by),
      created_at = COALESCE(created_at, issued_at)
  WHERE created_by IS NULL OR created_at IS NULL;
ALTER TABLE works.measurement_books FORCE ROW LEVEL SECURITY;

ALTER TABLE works.measurement_books
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

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
