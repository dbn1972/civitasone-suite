-- 0082_cpgrams_alignment.sql
-- CPGRAMS vocabulary alignment for the grievances module.
--
-- Changes:
--   1. Add forwarded_to, forwarded_at, appeal_reason columns.
--   2. Create crm.grievance_ref_seq sequence for ministry-prefixed reference numbers.
--   3. Drop old status CHECK constraint (6 CivitasOne values).
--   4. Migrate existing rows to CPGRAMS status vocabulary.
--   5. Add new status CHECK constraint (5 CPGRAMS values).
--
-- Legacy → CPGRAMS mapping:
--   open        → REGISTERED
--   assigned    → FORWARDED
--   in_progress → ATTENDED
--   resolved    → DISPOSED
--   closed      → DISPOSED
--   escalated   → APPEAL
--
-- Rollback:
--   ALTER TABLE crm.grievances DROP CONSTRAINT IF EXISTS grievances_status_cpgrams_check;
--   -- (restore old data and constraint manually if needed)
--   ALTER TABLE crm.grievances
--     DROP COLUMN IF EXISTS forwarded_to,
--     DROP COLUMN IF EXISTS forwarded_at,
--     DROP COLUMN IF EXISTS appeal_reason;
--   DROP SEQUENCE IF EXISTS crm.grievance_ref_seq;
SET lock_timeout = '5s';

-- 1. New columns for forward and appeal workflows
ALTER TABLE crm.grievances
  ADD COLUMN IF NOT EXISTS forwarded_to varchar(200),
  ADD COLUMN IF NOT EXISTS forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_reason text;

-- 2. Reference number sequence (start at 1; real deployments seed from current max)
CREATE SEQUENCE IF NOT EXISTS crm.grievance_ref_seq START 1;

-- 3. Drop old status CHECK constraint (system-generated name)
ALTER TABLE crm.grievances DROP CONSTRAINT IF EXISTS grievances_status_check;

-- 4. Migrate existing status values to CPGRAMS vocabulary
UPDATE crm.grievances
  SET status = CASE status
    WHEN 'open'        THEN 'REGISTERED'
    WHEN 'assigned'    THEN 'FORWARDED'
    WHEN 'in_progress' THEN 'ATTENDED'
    WHEN 'resolved'    THEN 'DISPOSED'
    WHEN 'closed'      THEN 'DISPOSED'
    WHEN 'escalated'   THEN 'APPEAL'
    ELSE 'REGISTERED'
  END
  WHERE status IN ('open','assigned','in_progress','resolved','closed','escalated');

-- 5. Add CPGRAMS-aligned CHECK constraint
ALTER TABLE crm.grievances
  ADD CONSTRAINT grievances_status_cpgrams_check
    CHECK (status IN ('REGISTERED','FORWARDED','ATTENDED','DISPOSED','APPEAL'));

-- Index for forwarded_to lookups (ministry offices query by department)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grievances_forwarded_to
  ON crm.grievances (tenant_id, forwarded_to)
  WHERE forwarded_to IS NOT NULL;
