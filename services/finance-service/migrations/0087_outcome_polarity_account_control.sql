-- 0087_outcome_polarity_account_control.sql
-- GAP-FINANCE-BUDGET-OUTCOME-BUDGET-02 (remainder): outcome indicators carry a
-- polarity so "lower is better" indicators (days, cost, error rate) can be
-- expressed and scored correctly. Baseline < target is only required for
-- higher_is_better; lower_is_better requires baseline > target.
-- achievement_recorded distinguishes "no measurement yet" from a genuine 0 --
-- needed because a 0 reading is the BEST possible score for lower_is_better.
-- GAP-FINANCE-JOURNAL-ENTRY-04 (remainder): finance_heads.is_control marks a
-- control account (a sub-ledger-controlled head) so manual journals can be
-- barred from posting to it directly.
-- Additive + idempotent. Safe to re-run.
-- Rollback:
--   ALTER TABLE budget.finance_heads DROP COLUMN IF EXISTS is_control;
--   ALTER TABLE budget.finance_budget_outcomes DROP CONSTRAINT IF EXISTS finance_budget_outcomes_baseline_vs_target;
--   ALTER TABLE budget.finance_budget_outcomes DROP CONSTRAINT IF EXISTS finance_budget_outcomes_polarity_chk;
--   ALTER TABLE budget.finance_budget_outcomes DROP COLUMN IF EXISTS achievement_recorded, DROP COLUMN IF EXISTS polarity;
--   ALTER TABLE budget.finance_budget_outcomes ADD CONSTRAINT finance_budget_outcomes_baseline_below_target CHECK (baseline_value < target_value);

SET lock_timeout = '5s';

ALTER TABLE budget.finance_budget_outcomes
  ADD COLUMN IF NOT EXISTS polarity varchar(24) NOT NULL DEFAULT 'higher_is_better';
ALTER TABLE budget.finance_budget_outcomes
  ADD COLUMN IF NOT EXISTS achievement_recorded boolean NOT NULL DEFAULT false;

ALTER TABLE budget.finance_budget_outcomes
  DROP CONSTRAINT IF EXISTS finance_budget_outcomes_baseline_below_target;
ALTER TABLE budget.finance_budget_outcomes
  DROP CONSTRAINT IF EXISTS finance_budget_outcomes_polarity_chk;
ALTER TABLE budget.finance_budget_outcomes
  ADD CONSTRAINT finance_budget_outcomes_polarity_chk
  CHECK (polarity IN ('higher_is_better','lower_is_better'));
ALTER TABLE budget.finance_budget_outcomes
  DROP CONSTRAINT IF EXISTS finance_budget_outcomes_baseline_vs_target;
ALTER TABLE budget.finance_budget_outcomes
  ADD CONSTRAINT finance_budget_outcomes_baseline_vs_target
  CHECK (
    (polarity = 'higher_is_better' AND baseline_value < target_value)
    OR (polarity = 'lower_is_better' AND baseline_value > target_value)
  );

ALTER TABLE budget.finance_heads
  ADD COLUMN IF NOT EXISTS is_control boolean NOT NULL DEFAULT false;
