-- Purpose: CDP-012 — segment activation runs, one row per (segment, channel) dispatch.
--          Tracks the audience size and lifecycle so a re-run is auditable.
-- Rollback: DROP TABLE IF EXISTS cdp.activations; (destructive — requires approval)
-- Affected services: cdp-service (owner); notification-service consumes the activation command
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.activations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  segment_id     uuid NOT NULL REFERENCES cdp.segments(id),
  channel        varchar(24) NOT NULL
                 CONSTRAINT activations_channel_chk
                 CHECK (channel IN ('sms', 'whatsapp', 'push', 'email', 'umang')),
  status         varchar(24) NOT NULL DEFAULT 'pending'
                 CONSTRAINT activations_status_chk
                 CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  audience_count int NOT NULL DEFAULT 0,
  started_at     timestamptz,
  completed_at   timestamptz,
  version        int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activations_tenant_status
  ON cdp.activations (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activations_tenant_channel
  ON cdp.activations (tenant_id, channel);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activations_segment
  ON cdp.activations (tenant_id, segment_id);

ALTER TABLE cdp.activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.activations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activations_tenant_isolation ON cdp.activations;
CREATE POLICY activations_tenant_isolation ON cdp.activations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.activations TO cdp_svc;
  END IF;
END $g$;
