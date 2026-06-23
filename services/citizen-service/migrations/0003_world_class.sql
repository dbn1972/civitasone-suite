CREATE TABLE IF NOT EXISTS citizen.sla_escalation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  priority VARCHAR(16) NOT NULL, escalation_hours INT NOT NULL,
  escalate_to VARCHAR(64) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
