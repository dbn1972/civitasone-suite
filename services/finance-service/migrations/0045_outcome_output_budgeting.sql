-- SVC-040 — Outcome / output budgeting.
-- Links a budget allocation to outputs, outcomes, indicators, targets,
-- achievements and a maker-checker evaluation.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE budget.finance_budget_outcomes;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS budget.finance_budget_outcomes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  head_id           uuid NOT NULL,
  fy                char(7) NOT NULL,
  allocation_id     uuid,
  scheme_id         uuid,
  output_desc       text NOT NULL,
  outcome_desc      text NOT NULL,
  indicator         text NOT NULL,
  unit              text NOT NULL,
  baseline_value    bigint NOT NULL DEFAULT 0,
  target_value      bigint NOT NULL,
  achieved_value    bigint NOT NULL DEFAULT 0,
  allocated_minor   bigint NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL DEFAULT 'INR',
  status            varchar(24) NOT NULL DEFAULT 'draft',
  evaluation_rating varchar(24),
  evaluation_note   text,
  evaluated_by      uuid,
  evaluated_at      timestamptz,
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT finance_budget_outcomes_target_positive CHECK (target_value > 0),
  CONSTRAINT finance_budget_outcomes_baseline_below_target CHECK (baseline_value < target_value),
  CONSTRAINT finance_budget_outcomes_achieved_nonneg CHECK (achieved_value >= 0),
  CONSTRAINT finance_budget_outcomes_alloc_nonneg CHECK (allocated_minor >= 0),
  CONSTRAINT finance_budget_outcomes_status_chk
    CHECK (status IN ('draft','active','evaluated','closed')),
  CONSTRAINT finance_budget_outcomes_rating_chk
    CHECK (evaluation_rating IS NULL OR evaluation_rating IN ('not_achieved','at_risk','on_track','achieved'))
);

CREATE INDEX IF NOT EXISTS idx_finance_budget_outcomes_tenant_fy
  ON budget.finance_budget_outcomes (tenant_id, fy);
CREATE INDEX IF NOT EXISTS idx_finance_budget_outcomes_head
  ON budget.finance_budget_outcomes (tenant_id, head_id);
CREATE INDEX IF NOT EXISTS idx_finance_budget_outcomes_allocation
  ON budget.finance_budget_outcomes (allocation_id);

-- RLS: full tenant isolation (mirror 0035_rls_full_tenant_isolation.sql).
ALTER TABLE budget.finance_budget_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_budget_outcomes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_budget_outcomes;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budget_outcomes;
CREATE POLICY tenant_isolation_policy ON budget.finance_budget_outcomes
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
