-- Citizen SLA configuration and escalation tracking
CREATE TABLE IF NOT EXISTS citizen.citizen_sla_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ticket_type VARCHAR(32) NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  response_hours INT NOT NULL DEFAULT 24,
  resolution_hours INT NOT NULL DEFAULT 72,
  escalation_after_hours INT NOT NULL DEFAULT 48,
  escalate_to_role VARCHAR(64) NOT NULL DEFAULT 'hod',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(tenant_id, ticket_type, priority)
);

CREATE TABLE IF NOT EXISTS citizen.citizen_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ticket_id UUID NOT NULL,
  escalated_to UUID NOT NULL,
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason VARCHAR(256) NOT NULL,
  level INT NOT NULL DEFAULT 1
);

INSERT INTO citizen.citizen_sla_config (tenant_id, ticket_type, priority, response_hours, resolution_hours, escalation_after_hours)
VALUES
  ('00000000-0000-0000-0000-000000000001','grievance','high',4,24,8),
  ('00000000-0000-0000-0000-000000000001','grievance','normal',12,72,48),
  ('00000000-0000-0000-0000-000000000001','rti','normal',24,720,168)
ON CONFLICT DO NOTHING;
