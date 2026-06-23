-- helpdesk-service: add assignee_id to tickets for P1-CRM-003

ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS assignee_id uuid;

CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON helpdesk.tickets(assignee_id)
  WHERE assignee_id IS NOT NULL;
