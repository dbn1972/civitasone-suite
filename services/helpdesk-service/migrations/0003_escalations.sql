CREATE TABLE IF NOT EXISTS helpdesk.ticket_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ticket_id UUID NOT NULL,
  escalated_by UUID NOT NULL,
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL,
  level INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_helpdesk_escalations_ticket ON helpdesk.ticket_escalations(tenant_id, ticket_id);
