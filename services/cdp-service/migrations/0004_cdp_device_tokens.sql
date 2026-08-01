-- Purpose: CDP-007 — cross-device identity graph. Links an opaque device TOKEN to a
--          golden profile.
-- Privacy: only the token issued by the collecting client is stored. Raw device
--          fingerprints (IDFA/GAID/UA hashes/canvas signatures) are deliberately NOT
--          persisted — under DPDP Act 2023 a fingerprint is identifying personal data,
--          while a revocable token can be rotated and purged on a DSAR erasure.
-- Rollback: DROP TABLE IF EXISTS cdp.device_tokens; (destructive — requires approval)
-- Affected services: cdp-service only
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.device_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  profile_id   uuid NOT NULL REFERENCES cdp.profiles(id),
  device_token varchar(256) NOT NULL,
  device_type  varchar(32) NOT NULL DEFAULT 'unknown',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  version      int NOT NULL DEFAULT 1
);

-- A device belongs to exactly one profile per tenant; re-linking the same token
-- moves it rather than creating a second edge in the graph.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_device_tokens_tenant_token
  ON cdp.device_tokens (tenant_id, device_token);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_tokens_profile
  ON cdp.device_tokens (tenant_id, profile_id, last_seen_at DESC);

ALTER TABLE cdp.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.device_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_tenant_isolation ON cdp.device_tokens;
CREATE POLICY device_tokens_tenant_isolation ON cdp.device_tokens
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.device_tokens TO cdp_svc;
  END IF;
END $g$;
