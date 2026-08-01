-- Migration: 0025_hold_queue.sql
-- Purpose: Create helpdesk.hold_queue table for ticket queueing when no agent available
-- Rollback: DROP TABLE IF EXISTS helpdesk.hold_queue;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.hold_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  ticket_id   uuid NOT NULL,
  queue_name  varchar(128) NOT NULL DEFAULT 'default',
  entered_at  timestamptz NOT NULL DEFAULT now(),
  priority    int NOT NULL DEFAULT 0,
  version     int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hold_queue_tenant_queue_priority
  ON helpdesk.hold_queue (tenant_id, queue_name, priority DESC, entered_at ASC);

-- RLS
ALTER TABLE helpdesk.hold_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.hold_queue FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hold_queue' AND policyname = 'hold_queue_tenant_isolation'
  ) THEN
    CREATE POLICY hold_queue_tenant_isolation ON helpdesk.hold_queue
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.hold_queue TO helpdesk_svc;
