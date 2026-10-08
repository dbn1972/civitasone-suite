-- Purpose: Create ticket_knowledge_links table for linking knowledge articles to tickets (CS-004)
-- Rollback: DROP TABLE IF EXISTS helpdesk.ticket_knowledge_links;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.ticket_knowledge_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  ticket_id       uuid NOT NULL REFERENCES helpdesk.tickets(id),
  article_id      uuid NOT NULL,
  article_title   varchar(200) NOT NULL,
  linked_by       uuid NOT NULL,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ticket_knowledge_link UNIQUE (tenant_id, ticket_id, article_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_knowledge_links_ticket
  ON helpdesk.ticket_knowledge_links (ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_knowledge_links_tenant
  ON helpdesk.ticket_knowledge_links (tenant_id);

-- RLS
ALTER TABLE helpdesk.ticket_knowledge_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_knowledge_links FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ticket_knowledge_links' AND policyname = 'ticket_knowledge_links_tenant_isolation'
  ) THEN
    CREATE POLICY ticket_knowledge_links_tenant_isolation ON helpdesk.ticket_knowledge_links
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.ticket_knowledge_links TO helpdesk_svc;
