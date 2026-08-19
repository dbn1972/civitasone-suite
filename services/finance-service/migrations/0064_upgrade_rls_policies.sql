-- DB-L3: Upgrade 3 legacy RLS policies that lack WITH CHECK clause.
-- Recreates each with both USING and WITH CHECK for full tenant isolation on writes.

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budget_distribution;
  DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_budget_distribution;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY tenant_isolation_policy ON budget.finance_budget_distribution
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON budget.finance_outcome_budget;
  DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_outcome_budget;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY tenant_isolation_policy ON budget.finance_outcome_budget
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON budget.finance_supplementary;
  DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_supplementary;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY tenant_isolation_policy ON budget.finance_supplementary
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
