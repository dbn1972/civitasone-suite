-- L1: prevent committed+actual exceeding allocated at the DB level
-- Note: PostgreSQL CHECK constraints cannot be DEFERRABLE
ALTER TABLE budget.finance_budget_allocation
  ADD CONSTRAINT chk_allocation_no_overcommit
  CHECK (committed_minor + actual_minor <= allocated_minor);
