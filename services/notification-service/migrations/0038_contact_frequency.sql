-- Purpose: Gap 4 — per-contact frequency cap to prevent over-messaging
-- Rollback: DROP TABLE IF EXISTS notification.contact_frequency;
-- Affected services: notification-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS notification.contact_frequency (
  tenant_id     uuid NOT NULL,
  contact_id    uuid NOT NULL,
  channel       text NOT NULL,
  period_start  date NOT NULL,
  count         int NOT NULL DEFAULT 0,
  CONSTRAINT contact_frequency_pk UNIQUE (tenant_id, contact_id, channel, period_start)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_frequency_lookup
  ON notification.contact_frequency (tenant_id, contact_id, channel, period_start);

ALTER TABLE notification.contact_frequency ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'contact_frequency' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON notification.contact_frequency
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
