-- 0072_gl_leaf_account_guard.sql
-- DOM-010: finance_heads had no way to express a parent/child relationship,
-- so nothing could ever tell whether a head was a summary ("parent")
-- account or a postable leaf. Add a nullable, self-referencing parent_id so
-- a head can declare its parent; a head with at least one other head
-- pointing at it via parent_id is a group/summary head and
-- gl/consumer.ts's postJournal now rejects postings to it.
--
-- Additive + backward compatible: parent_id defaults to NULL, so every
-- existing head is unaffected (no existing head lists itself as anyone's
-- parent) and the new guard is behaviourally inert until a hierarchy is
-- actually built via a future parent_id-setting change.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS budget.idx_finance_heads_parent_id;
--   ALTER TABLE budget.finance_heads DROP COLUMN IF EXISTS parent_id;

SET lock_timeout = '5s';

ALTER TABLE budget.finance_heads
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES budget.finance_heads(id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_heads_parent_id
  ON budget.finance_heads (parent_id) WHERE parent_id IS NOT NULL;
