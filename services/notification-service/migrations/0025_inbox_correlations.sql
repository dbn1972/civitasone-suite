-- Purpose: INT-04 — Ticket-ID Correlation in Inbox Threading.
-- Creates notification.inbox_correlations table to link conversation threads to helpdesk tickets.
-- Rollback: DROP TABLE IF EXISTS notification.inbox_correlations;
-- Affected services: notification-service, helpdesk-service (consumer)

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS notification.inbox_correlations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  conversation_id uuid NOT NULL,
  ticket_id       uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Unique: one correlation per conversation per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_corr_tenant_conv
  ON notification.inbox_correlations (tenant_id, conversation_id);

-- Fast lookup by ticket
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_corr_ticket
  ON notification.inbox_correlations (tenant_id, ticket_id);

-- RLS
ALTER TABLE notification.inbox_correlations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.inbox_correlations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inbox_correlations' AND schemaname = 'notification' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON notification.inbox_correlations
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- Restricted grant
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_app') THEN
    GRANT SELECT, INSERT ON notification.inbox_correlations TO notification_app;
  END IF;
END $$;
