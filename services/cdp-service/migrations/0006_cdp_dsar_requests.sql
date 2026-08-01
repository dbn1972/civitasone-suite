-- Purpose: CDP-011 — DSAR (Data Subject Access Request) register. Completing a request
--          emits an event so segments and activations purge the profile downstream.
-- Compliance: DPDP Act 2023 §§11-13 (access, correction, erasure). The register is the
--            evidence trail that a request was received and discharged.
-- Rollback: DROP TABLE IF EXISTS cdp.dsar_requests; (destructive — requires approval)
-- Affected services: cdp-service (owner); consumers of cdp.dsar.completed
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.dsar_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  profile_id   uuid NOT NULL REFERENCES cdp.profiles(id),
  request_type varchar(24) NOT NULL
               CONSTRAINT dsar_requests_type_chk
               CHECK (request_type IN ('access', 'erasure', 'rectification', 'portability')),
  status       varchar(24) NOT NULL DEFAULT 'pending'
               CONSTRAINT dsar_requests_status_chk
               CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  reason       text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  version      int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dsar_requests_tenant_status
  ON cdp.dsar_requests (tenant_id, status, requested_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dsar_requests_profile
  ON cdp.dsar_requests (tenant_id, profile_id);
-- Statutory clock: open requests are the ones an SLA report has to chase.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dsar_requests_open
  ON cdp.dsar_requests (tenant_id, requested_at DESC)
  WHERE status IN ('pending', 'in_progress');

ALTER TABLE cdp.dsar_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.dsar_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dsar_requests_tenant_isolation ON cdp.dsar_requests;
CREATE POLICY dsar_requests_tenant_isolation ON cdp.dsar_requests
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.dsar_requests TO cdp_svc;
  END IF;
END $g$;
