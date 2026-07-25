-- SVC-035 — Supplementary / additional grant demands.
-- Adds fresh provision to an existing budget head under a sanctioning authority,
-- capped by an optional limit, approved maker-checker; on approval the target
-- budget's BE + RE rise (updated availability).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE budget.finance_supplementary_demands;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS budget.finance_supplementary_demands (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  fy             char(7) NOT NULL,
  budget_id      uuid NOT NULL,
  head_id        uuid NOT NULL,
  amount_minor   bigint NOT NULL,
  limit_minor    bigint NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'INR',
  kind           varchar(24) NOT NULL DEFAULT 'supplementary',
  authority      text NOT NULL,
  reason         text NOT NULL,
  status         varchar(24) NOT NULL DEFAULT 'pending_approval',
  approved_by    uuid,
  approved_at    timestamptz,
  reject_reason  text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT finance_supp_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT finance_supp_limit_nonneg CHECK (limit_minor >= 0),
  CONSTRAINT finance_supp_kind_chk CHECK (kind IN ('supplementary','additional','excess')),
  CONSTRAINT finance_supp_status_chk CHECK (status IN ('pending_approval','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_finance_supp_tenant_fy
  ON budget.finance_supplementary_demands (tenant_id, fy);
CREATE INDEX IF NOT EXISTS idx_finance_supp_budget
  ON budget.finance_supplementary_demands (tenant_id, budget_id);
CREATE INDEX IF NOT EXISTS idx_finance_supp_status
  ON budget.finance_supplementary_demands (tenant_id, status);

-- RLS: full tenant isolation.
ALTER TABLE budget.finance_supplementary_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_supplementary_demands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_supplementary_demands;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_supplementary_demands;
CREATE POLICY tenant_isolation_policy ON budget.finance_supplementary_demands
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
