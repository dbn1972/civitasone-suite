-- Enterprise helpdesk fields on citizen tickets + escalation audit trail
ALTER TABLE helpdesk.citizen_tickets
  ADD COLUMN IF NOT EXISTS ticket_no VARCHAR(32),
  ADD COLUMN IF NOT EXISTS priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS category VARCHAR(64) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS channel VARCHAR(24) NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS assignee_id UUID,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(32) NOT NULL DEFAULT 'grievance';

CREATE TABLE IF NOT EXISTS helpdesk.ticket_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ticket_id UUID NOT NULL,
  escalated_by UUID NOT NULL,
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL,
  level INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_citizen_tickets_sla ON helpdesk.citizen_tickets(tenant_id, status, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_ticket_escalations_ticket ON helpdesk.ticket_escalations(tenant_id, ticket_id);

UPDATE helpdesk.citizen_tickets
SET ticket_no = 'HD-' || UPPER(SUBSTRING(id::text, 1, 8))
WHERE ticket_no IS NULL;
