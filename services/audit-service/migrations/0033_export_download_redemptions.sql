-- 0033_export_download_redemptions.sql
-- Q34: audit export download tokens are single-use. The signed, 15-minute
-- query-string token is still an HMAC (nothing to store when it is minted), but
-- every successful download now records a redemption keyed by the SHA-256 of the
-- token; a second use of the same token finds the row and is refused (410).
-- Additive & idempotent. New table: tenant_id + ENABLE/FORCE RLS + tenant_isolation
--   policy (events.current_tenant_id()), mirroring 0032 / 0013_rls_full_tenant_isolation.sql.
-- Rollback: DROP TABLE exports.download_redemptions;
-- Affected services: audit-service only.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS exports.download_redemptions (
  tenant_id    uuid        NOT NULL,
  token_sha256 varchar(64) NOT NULL,
  export_id    uuid        NOT NULL,
  redeemed_by  uuid        NOT NULL,
  redeemed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, token_sha256),
  CONSTRAINT download_redemptions_sha_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_download_redemptions_export ON exports.download_redemptions (tenant_id, export_id);
CREATE INDEX IF NOT EXISTS idx_download_redemptions_redeemed_at ON exports.download_redemptions (redeemed_at);

ALTER TABLE exports.download_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports.download_redemptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON exports.download_redemptions;
CREATE POLICY tenant_isolation_policy ON exports.download_redemptions
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());
