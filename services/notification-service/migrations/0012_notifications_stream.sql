-- Purpose: Add notifications table for SSE real-time delivery and offline persistence.
-- Rollback: DROP TABLE IF EXISTS stream.notifications; DROP SCHEMA IF EXISTS stream;
-- Affected services: notification-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS stream;

CREATE TABLE IF NOT EXISTS stream.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(256) NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

-- Index for fetching unread notifications per user (tenant-scoped)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread
  ON stream.notifications (tenant_id, user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Index for marking notifications as read
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id
  ON stream.notifications (tenant_id, user_id, id);

-- RLS enforcement
ALTER TABLE stream.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream.notifications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND schemaname = 'stream' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON stream.notifications
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;
