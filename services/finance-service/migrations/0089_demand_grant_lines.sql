-- 0089_demand_grant_lines.sql
-- GAP-FINANCE-BUDGET-DEMAND-GRANTS-04: head-wise (per major head) line items of
-- a demand for grants, so a demand can be drilled into. The set of lines is
-- replaced atomically and must total the demand amount (enforced in the
-- consumer, inside the write transaction).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE budget.finance_demand_lines;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS budget.finance_demand_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  demand_id     uuid NOT NULL REFERENCES budget.finance_demands(id) ON DELETE CASCADE,
  head_id       uuid,
  head_code     text NOT NULL,
  head_name     text,
  amount_minor  bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  CONSTRAINT finance_demand_lines_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT finance_demand_lines_uq UNIQUE (tenant_id, demand_id, head_code)
);

CREATE INDEX IF NOT EXISTS idx_finance_demand_lines_demand
  ON budget.finance_demand_lines (tenant_id, demand_id);

ALTER TABLE budget.finance_demand_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_demand_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_demand_lines;
CREATE POLICY tenant_isolation_policy ON budget.finance_demand_lines
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
