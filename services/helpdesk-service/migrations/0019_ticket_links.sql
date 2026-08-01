-- Purpose: Create ticket_links table for parent/child and duplicate linking (TKT-08)
-- Rollback: DROP TABLE IF EXISTS helpdesk.ticket_links;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.ticket_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  source_ticket_id  uuid NOT NULL REFERENCES helpdesk.tickets(id),
  target_ticket_id  uuid NOT NULL REFERENCES helpdesk.tickets(id),
  link_type         varchar(24) NOT NULL CHECK (link_type IN ('parent', 'child', 'duplicate', 'related')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  CONSTRAINT no_self_link CHECK (source_ticket_id <> target_ticket_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_links_source
  ON helpdesk.ticket_links (source_ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_links_target
  ON helpdesk.ticket_links (target_ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_links_tenant_id
  ON helpdesk.ticket_links (tenant_id);

-- RLS
ALTER TABLE helpdesk.ticket_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_links FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ticket_links' AND policyname = 'ticket_links_tenant_isolation'
  ) THEN
    CREATE POLICY ticket_links_tenant_isolation ON helpdesk.ticket_links
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.ticket_links TO helpdesk_svc;
