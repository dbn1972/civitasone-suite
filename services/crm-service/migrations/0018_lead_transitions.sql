-- Purpose: Create crm.lead_transitions table for lifecycle audit trail (LQ-004).
-- Rollback: DROP TABLE IF EXISTS crm.lead_transitions;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.lead_transitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  contact_id    uuid NOT NULL REFERENCES crm.contacts(id),
  from_status   varchar(32) NOT NULL,
  to_status     varchar(32) NOT NULL,
  reason        text NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

-- RLS: tenant isolation
ALTER TABLE crm.lead_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_transitions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lead_transitions' AND schemaname = 'crm' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON crm.lead_transitions
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- Guarded GRANT to crm_svc role
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT ON crm.lead_transitions TO crm_svc;
  END IF;
END $$;

-- Index for lookups by contact
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_transitions_contact
  ON crm.lead_transitions (tenant_id, contact_id, created_at DESC);
