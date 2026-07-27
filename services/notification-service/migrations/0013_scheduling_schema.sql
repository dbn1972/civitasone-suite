-- Purpose: Add scheduling schema for deferred notification delivery
-- Rollback: DROP SCHEMA scheduling CASCADE;
-- Affected services: notification-service (scheduling module, schedule sweeper)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS scheduling;

CREATE TABLE IF NOT EXISTS scheduling.scheduled_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  template_id   uuid NOT NULL,
  recipient     varchar(254) NOT NULL,
  recipient_id  uuid,
  channel       varchar(32) NOT NULL,
  priority      varchar(16) NOT NULL DEFAULT 'normal',
  variables     jsonb NOT NULL DEFAULT '{}',
  scheduled_at  timestamptz NOT NULL,
  status        varchar(24) NOT NULL DEFAULT 'scheduled',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_sched_status CHECK (status IN ('scheduled', 'queued', 'cancelled'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sched_due
  ON scheduling.scheduled_notifications (scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sched_tenant
  ON scheduling.scheduled_notifications (tenant_id);

-- Enable RLS for tenant isolation
ALTER TABLE scheduling.scheduled_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduling_tenant_isolation ON scheduling.scheduled_notifications;
CREATE POLICY scheduling_tenant_isolation
  ON scheduling.scheduled_notifications
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
