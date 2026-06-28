-- finance-service: Budget Re-appropriation request entity.
-- Additive, idempotent, forward-only.
--
-- A re-appropriation can now be routed through eOffice for administrative
-- approval before it touches the target budget. The request carries its own
-- status; on approval the eOffice decision callback applies the change to the
-- target budget's re_minor (same effect as the direct re_appropriate path).

CREATE TABLE IF NOT EXISTS budget.finance_reappropriations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  budget_id        uuid        NOT NULL,            -- target budget whose re_minor is updated on approval
  head_id          uuid,                            -- reference head (nullable)
  amount_minor     bigint      NOT NULL DEFAULT 0,  -- new revised-estimate target (paise)
  reason           text        NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'pending_approval',  -- pending_approval|approved|rejected
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_freappropriations_tenant_status
  ON budget.finance_reappropriations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_freappropriations_budget
  ON budget.finance_reappropriations(budget_id);
