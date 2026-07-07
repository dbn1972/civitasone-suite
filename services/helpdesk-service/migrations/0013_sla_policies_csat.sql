-- helpdesk-service: SLA policies + CSAT responses tables.
-- Additive + idempotent. Rollback: DROP TABLE IF EXISTS helpdesk.csat_responses; DROP TABLE IF EXISTS helpdesk.sla_policies;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

-- SLA Policies: per-priority+category response/resolution deadlines
CREATE TABLE IF NOT EXISTS helpdesk.sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  priority VARCHAR(24) NOT NULL,
  category VARCHAR(128),
  response_minutes INT NOT NULL,
  resolution_minutes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

-- Unique constraint: one policy per tenant+priority+category combination
CREATE UNIQUE INDEX IF NOT EXISTS uq_sla_policies_tenant_priority_category
  ON helpdesk.sla_policies(tenant_id, priority, COALESCE(category, '__null__'));

-- Index for policy lookup by tenant
CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant
  ON helpdesk.sla_policies(tenant_id);

-- CSAT Responses: post-resolution survey results (1-5 scale)
CREATE TABLE IF NOT EXISTS helpdesk.csat_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ticket_id UUID NOT NULL,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- One CSAT response per ticket
CREATE UNIQUE INDEX IF NOT EXISTS uq_csat_responses_ticket
  ON helpdesk.csat_responses(ticket_id);

-- Index for CSAT aggregation queries by tenant
CREATE INDEX IF NOT EXISTS idx_csat_responses_tenant
  ON helpdesk.csat_responses(tenant_id);

-- RLS for new tables
ALTER TABLE helpdesk.sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.sla_policies FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sla_policies' AND schemaname = 'helpdesk' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON helpdesk.sla_policies
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

ALTER TABLE helpdesk.csat_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.csat_responses FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'csat_responses' AND schemaname = 'helpdesk' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON helpdesk.csat_responses
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
