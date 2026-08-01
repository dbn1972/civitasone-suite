-- Purpose: Create ticket_notes table for internal notes and public replies (TKT-04)
-- Rollback: DROP TABLE IF EXISTS helpdesk.ticket_notes;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.ticket_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  ticket_id   uuid NOT NULL REFERENCES helpdesk.tickets(id),
  content     text NOT NULL,
  visibility  varchar(16) NOT NULL CHECK (visibility IN ('internal', 'public')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_notes_ticket_id
  ON helpdesk.ticket_notes (ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_notes_tenant_id
  ON helpdesk.ticket_notes (tenant_id);

-- RLS
ALTER TABLE helpdesk.ticket_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_notes FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ticket_notes' AND policyname = 'ticket_notes_tenant_isolation'
  ) THEN
    CREATE POLICY ticket_notes_tenant_isolation ON helpdesk.ticket_notes
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.ticket_notes TO helpdesk_svc;
