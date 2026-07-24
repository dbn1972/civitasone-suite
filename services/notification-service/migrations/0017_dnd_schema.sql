-- Purpose: Add Do Not Disturb windows and held notifications
-- Rollback: DROP SCHEMA dnd CASCADE;
-- Affected services: notification-service (dnd module, DND release sweeper, delivery pipeline)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS dnd;

CREATE TABLE IF NOT EXISTS dnd.dnd_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  timezone    varchar(64) NOT NULL,
  days        jsonb NOT NULL DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]',
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dnd_user
  ON dnd.dnd_windows (tenant_id, user_id) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS dnd.held_notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  user_id          uuid NOT NULL,
  delivery_payload jsonb NOT NULL,
  hold_until       timestamptz NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'held',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_held_status CHECK (status IN ('held', 'released', 'cancelled'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_held_release
  ON dnd.held_notifications (hold_until)
  WHERE status = 'held';

-- Enable RLS for tenant isolation
ALTER TABLE dnd.dnd_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS dnd_windows_tenant_isolation
  ON dnd.dnd_windows
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE dnd.held_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS dnd_held_tenant_isolation
  ON dnd.held_notifications
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
