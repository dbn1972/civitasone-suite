-- SVC-033 — Allocation & distribution.
-- Distribution of an original allocation to subordinate offices: effective-dated,
-- condition-bearing, acknowledged by the receiving office. Aggregate
-- distributions may never exceed the parent allocation.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE budget.finance_allocation_distributions;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS budget.finance_allocation_distributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  allocation_id     uuid NOT NULL,
  fy                char(7) NOT NULL,
  head_id           uuid NOT NULL,
  from_office_id    uuid NOT NULL,
  to_office_id      uuid NOT NULL,
  amount_minor      bigint NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'INR',
  conditions        text,
  status            varchar(24) NOT NULL DEFAULT 'draft',
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  issued_by         uuid,
  issued_at         timestamptz,
  acknowledged_by   uuid,
  acknowledged_at   timestamptz,
  acknowledge_note  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT finance_alloc_dist_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT finance_alloc_dist_offices_distinct CHECK (from_office_id <> to_office_id),
  CONSTRAINT finance_alloc_dist_status_chk
    CHECK (status IN ('draft','issued','acknowledged','returned'))
);

CREATE INDEX IF NOT EXISTS idx_finance_alloc_dist_allocation
  ON budget.finance_allocation_distributions (tenant_id, allocation_id);
CREATE INDEX IF NOT EXISTS idx_finance_alloc_dist_tenant_fy
  ON budget.finance_allocation_distributions (tenant_id, fy);
CREATE INDEX IF NOT EXISTS idx_finance_alloc_dist_to_office
  ON budget.finance_allocation_distributions (tenant_id, to_office_id, fy);

-- RLS: full tenant isolation.
ALTER TABLE budget.finance_allocation_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_allocation_distributions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_allocation_distributions;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_allocation_distributions;
CREATE POLICY tenant_isolation_policy ON budget.finance_allocation_distributions
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
