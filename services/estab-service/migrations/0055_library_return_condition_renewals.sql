-- 0055_library_return_condition_renewals.sql
-- GAP-ESTAB-LIBRARY-ISSUES-05 (owner decision #29, 2026-10-26): a loan records the CONDITION the book
-- came back in (good / fair / damaged, optional notes) and how many times it was renewed. Fines are NOT
-- in UAT scope (the screen says fine rules are not configured), so no money columns are added here.
-- Rollback: ALTER TABLE facilities.estab_issues DROP COLUMN IF EXISTS return_condition,
--           DROP COLUMN IF EXISTS return_notes, DROP COLUMN IF EXISTS renewal_count;
-- Affected services: estab-service only. Additive columns (nullable / defaulted): safe on a table of any size.

SET lock_timeout = '5s';

ALTER TABLE facilities.estab_issues
  ADD COLUMN IF NOT EXISTS return_condition varchar(16),
  ADD COLUMN IF NOT EXISTS return_notes text,
  ADD COLUMN IF NOT EXISTS renewal_count integer NOT NULL DEFAULT 0;

ALTER TABLE facilities.estab_issues DROP CONSTRAINT IF EXISTS chk_estab_issues_return_condition;
ALTER TABLE facilities.estab_issues
  ADD CONSTRAINT chk_estab_issues_return_condition
  CHECK (return_condition IS NULL OR return_condition IN ('good', 'fair', 'damaged'));

ALTER TABLE facilities.estab_issues DROP CONSTRAINT IF EXISTS chk_estab_issues_renewal_count;
ALTER TABLE facilities.estab_issues
  ADD CONSTRAINT chk_estab_issues_renewal_count CHECK (renewal_count >= 0);
