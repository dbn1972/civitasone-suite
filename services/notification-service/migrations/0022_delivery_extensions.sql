-- Purpose: Add priority and scheduling fields to deliveries table
-- Rollback: ALTER TABLE deliveries.deliveries DROP COLUMN IF EXISTS priority, DROP COLUMN IF EXISTS scheduled_at;
-- Affected services: notification-service (delivery pipeline, priority module, scheduling module)
SET lock_timeout = '5s';

ALTER TABLE deliveries.deliveries
  ADD COLUMN IF NOT EXISTS priority varchar(16) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
