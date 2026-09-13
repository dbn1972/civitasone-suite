-- Purpose: COMP-016 follow-up — add 5 real columns backing the
--   apps/web /projects/schemes/[id] detail fields that have no column
--   anywhere in project-service's schema today (verified against this
--   file's pre-migration state of scheme/schema.ts and project/schema.ts):
--   nodal_officer, department, beneficiaries, start_date, end_date. PR #1240
--   (COMP-016) deliberately rendered these as an honest "--" instead of
--   inventing values, and left "add columns vs. drop from the UI" as an
--   open product/schema decision rather than deciding it unilaterally. The
--   decision is now: add the columns.
-- Rollback: ALTER TABLE scheme.project_schemes DROP COLUMN IF EXISTS nodal_officer,
--   DROP COLUMN IF EXISTS department, DROP COLUMN IF EXISTS beneficiaries,
--   DROP COLUMN IF EXISTS start_date, DROP COLUMN IF EXISTS end_date;
--   (dropping a column drops any check constraint defined on it; the
--   separate two-column dates constraint below would need an explicit
--   DROP CONSTRAINT IF EXISTS project_schemes_dates_chk first if start_date/
--   end_date were being dropped independently of each other).
-- Affected services: project-service (scheme module)

SET lock_timeout = '5s';

-- All 5 columns are nullable, no DEFAULT: existing rows have no value for
-- any of them, and a NOT NULL/defaulted column would force one on every
-- row that predates this migration — this migration must not invent one.
ALTER TABLE scheme.project_schemes
  ADD COLUMN IF NOT EXISTS nodal_officer text,
  ADD COLUMN IF NOT EXISTS department    text,
  -- Nonneg-if-present: same nullable-numeric "IS NULL OR col >= 0" pattern as
  -- crm.deals.quantity (services/crm-service/migrations/0059_deal_opportunity_fields.sql:
  -- "quantity integer CHECK (quantity IS NULL OR quantity >= 0)") — this
  -- table's own existing nonneg checks (e.g. money/percentage columns) are
  -- all NOT NULL with a DEFAULT, so quantity is the closest sibling for a
  -- genuinely optional nonneg integer.
  ADD COLUMN IF NOT EXISTS beneficiaries integer CHECK (beneficiaries IS NULL OR beneficiaries >= 0),
  ADD COLUMN IF NOT EXISTS start_date    date,
  ADD COLUMN IF NOT EXISTS end_date      date;

-- Table-level (two-column) check, added separately since it can't be
-- expressed inline on a single ADD COLUMN clause. Mirrors this repo's own
-- date-range convention (hierarchy.postings_dates_chk,
-- services/location-service/migrations/0005a_org_model.sql:
-- "CHECK (effective_to IS NULL OR effective_to >= effective_from)"): an
-- "IS NULL OR" comparison is satisfied (NULL, not FALSE) whenever either
-- side is absent, so the constraint is a no-op until BOTH dates are set on
-- the same row, and only then actually enforced. Spelled out on both sides
-- here (start_date IS NULL OR end_date IS NULL OR ...) rather than
-- one-sided like the postings precedent, purely for readability — the
-- semantics are identical either way under SQL's three-valued NULL logic.
DO $$ BEGIN
  ALTER TABLE scheme.project_schemes
    ADD CONSTRAINT project_schemes_dates_chk
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
