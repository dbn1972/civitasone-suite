-- SVC-031 — Budget formulation & consolidation.
-- Departmental proposals against ceilings, versioned, justified, reviewed and
-- approved (maker-checker), then consolidated across heads.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE budget.finance_budget_formulation;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS budget.finance_budget_formulation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  fy             char(7) NOT NULL,
  dept_code      text NOT NULL,
  head_id        uuid NOT NULL,
  ceiling_minor  bigint NOT NULL DEFAULT 0,
  proposed_minor bigint NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'INR',
  justification  text NOT NULL DEFAULT '',
  status         varchar(24) NOT NULL DEFAULT 'draft',
  parent_id      uuid,
  review_note    text,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  approved_by    uuid,
  approved_at    timestamptz,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT finance_budget_formulation_ceiling_nonneg CHECK (ceiling_minor >= 0),
  CONSTRAINT finance_budget_formulation_proposed_nonneg CHECK (proposed_minor >= 0),
  CONSTRAINT finance_budget_formulation_status_chk
    CHECK (status IN ('draft','submitted','under_review','returned','approved'))
);

CREATE INDEX IF NOT EXISTS idx_finance_budget_formulation_tenant_fy
  ON budget.finance_budget_formulation (tenant_id, fy);
CREATE INDEX IF NOT EXISTS idx_finance_budget_formulation_dept
  ON budget.finance_budget_formulation (tenant_id, dept_code, fy);
CREATE INDEX IF NOT EXISTS idx_finance_budget_formulation_status
  ON budget.finance_budget_formulation (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_finance_budget_formulation_parent
  ON budget.finance_budget_formulation (parent_id);

-- RLS: full tenant isolation.
ALTER TABLE budget.finance_budget_formulation ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_budget_formulation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_budget_formulation;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budget_formulation;
CREATE POLICY tenant_isolation_policy ON budget.finance_budget_formulation
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
