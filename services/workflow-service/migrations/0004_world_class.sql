-- Workflow delegations: allow users to delegate approval authority
CREATE TABLE IF NOT EXISTS workflow.workflow_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  delegator_id UUID NOT NULL,
  delegate_id UUID NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE,
  reason VARCHAR(256),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
