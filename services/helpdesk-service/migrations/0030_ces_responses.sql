-- Migration: 0030_ces_responses.sql
-- Purpose: Create helpdesk.ces_responses for Customer Effort Score surveys
-- Rollback: DROP TABLE IF EXISTS helpdesk.ces_responses;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.ces_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  effort_score  int NOT NULL CHECK (effort_score >= 1 AND effort_score <= 7),
  comment       text,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL
);

-- Frequency cap index: max 1 per ticket
CREATE UNIQUE INDEX IF NOT EXISTS idx_ces_responses_ticket_unique
  ON helpdesk.ces_responses (tenant_id, ticket_id);

-- Frequency cap index: recent by customer
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ces_responses_customer_recent
  ON helpdesk.ces_responses (tenant_id, created_by, submitted_at DESC);

-- RLS
ALTER TABLE helpdesk.ces_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ces_responses FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ces_responses' AND policyname = 'ces_responses_tenant_isolation'
  ) THEN
    CREATE POLICY ces_responses_tenant_isolation ON helpdesk.ces_responses
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT ON helpdesk.ces_responses TO helpdesk_svc;
