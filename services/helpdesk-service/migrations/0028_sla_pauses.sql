-- Migration: 0028_sla_pauses.sql
-- Purpose: Create helpdesk.sla_pauses for pause/resume SLA timer per ticket
-- Rollback: DROP TABLE IF EXISTS helpdesk.sla_pauses;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.sla_pauses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  paused_at     timestamptz NOT NULL DEFAULT now(),
  resumed_at    timestamptz,
  pause_status  varchar(64) NOT NULL,
  created_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sla_pauses_tenant_ticket
  ON helpdesk.sla_pauses (tenant_id, ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sla_pauses_active
  ON helpdesk.sla_pauses (tenant_id, ticket_id)
  WHERE resumed_at IS NULL;

-- RLS
ALTER TABLE helpdesk.sla_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.sla_pauses FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sla_pauses' AND policyname = 'sla_pauses_tenant_isolation'
  ) THEN
    CREATE POLICY sla_pauses_tenant_isolation ON helpdesk.sla_pauses
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON helpdesk.sla_pauses TO helpdesk_svc;
