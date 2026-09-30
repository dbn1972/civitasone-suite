-- 0154_hrms_icc_case_no.sql
-- GAP-HR-ICC-04: a stable, citable case number for the ICC register.
-- Additive + idempotent.
--
-- Rollback: ALTER TABLE disciplinary.hrms_icc_complaints DROP COLUMN IF EXISTS case_no;

SET lock_timeout = '5s';

ALTER TABLE disciplinary.hrms_icc_complaints
  ADD COLUMN IF NOT EXISTS case_no varchar(32);

-- Backfill every existing row, per-tenant-per-year sequential, ordered by
-- filed_at (oldest first) -- matches the numbering a brand-new complaint
-- gets going forward (see f3-consumer.ts's insert).
WITH numbered AS (
  SELECT id,
         'ICC/' || EXTRACT(YEAR FROM filed_at)::int || '/' ||
           LPAD(
             ROW_NUMBER() OVER (
               PARTITION BY tenant_id, EXTRACT(YEAR FROM filed_at)
               ORDER BY filed_at, id
             )::text,
             3, '0'
           ) AS computed_case_no
  FROM disciplinary.hrms_icc_complaints
  WHERE case_no IS NULL
)
UPDATE disciplinary.hrms_icc_complaints c
SET case_no = numbered.computed_case_no
FROM numbered
WHERE c.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS hrms_icc_case_no_uq
  ON disciplinary.hrms_icc_complaints (tenant_id, case_no)
  WHERE case_no IS NOT NULL;
