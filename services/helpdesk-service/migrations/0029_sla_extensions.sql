-- Migration: 0029_sla_extensions.sql
-- Purpose: Create helpdesk.sla_extensions for approved SLA deadline extensions
-- Rollback: DROP TABLE IF EXISTS helpdesk.sla_extensions;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.sla_extensions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  ticket_id           uuid NOT NULL,
  additional_minutes  int NOT NULL,
  reason              text NOT NULL,
  approver_id         uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  version             int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sla_extensions_tenant_ticket
  ON helpdesk.sla_extensions (tenant_id, ticket_id);

-- RLS
ALTER TABLE helpdesk.sla_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.sla_extensions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sla_extensions' AND policyname = 'sla_extensions_tenant_isolation'
  ) THEN
    CREATE POLICY sla_extensions_tenant_isolation ON helpdesk.sla_extensions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT ON helpdesk.sla_extensions TO helpdesk_svc;
