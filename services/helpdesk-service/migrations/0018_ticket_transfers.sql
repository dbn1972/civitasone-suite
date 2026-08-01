-- Purpose: Create ticket_transfers table for cross-department transfer audit trail (TKT-07)
-- Rollback: DROP TABLE IF EXISTS helpdesk.ticket_transfers;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.ticket_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  ticket_id       uuid NOT NULL REFERENCES helpdesk.tickets(id),
  from_department varchar(128),
  to_department   varchar(128) NOT NULL,
  reason          text NOT NULL,
  transferred_at  timestamptz NOT NULL DEFAULT now(),
  transferred_by  uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_transfers_ticket_id
  ON helpdesk.ticket_transfers (ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_transfers_tenant_id
  ON helpdesk.ticket_transfers (tenant_id);

-- RLS
ALTER TABLE helpdesk.ticket_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_transfers FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ticket_transfers' AND policyname = 'ticket_transfers_tenant_isolation'
  ) THEN
    CREATE POLICY ticket_transfers_tenant_isolation ON helpdesk.ticket_transfers
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.ticket_transfers TO helpdesk_svc;
