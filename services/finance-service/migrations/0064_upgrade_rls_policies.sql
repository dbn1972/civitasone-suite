-- DB-L3: Upgrade 3 legacy RLS policies that lack WITH CHECK clause.
-- Recreates each with both USING and WITH CHECK for full tenant isolation on writes.

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON budget.finance_allocation_distributions;
  DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_allocation_distributions;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY tenant_isolation_policy ON budget.finance_allocation_distributions
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budget_outcomes;
  DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_budget_outcomes;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY tenant_isolation_policy ON budget.finance_budget_outcomes
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON budget.finance_supplementary_demands;
  DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_supplementary_demands;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY tenant_isolation_policy ON budget.finance_supplementary_demands
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
