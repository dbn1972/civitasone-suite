-- UAT FQ9 #37: deterministic lookup columns for device bearer-token authentication.
--
-- device_token_hash / old_token_hash are stored with the app's encryptedText() envelope
-- (AES-256-GCM, RANDOM IV). device-auth looked a device up with
-- `WHERE device_token_hash = $1`, and the parameter was encrypted with a fresh IV each time, so the
-- lookup could never match and every bearer-token device got 401 DEVICE_CREDENTIAL_REVOKED.
-- These columns hold the keyed blind index (HMAC-SHA256, pii-crypto.ts blindIndex) of the token
-- hash. The encrypted columns are unchanged.
--
-- Existing devices: the blind index can only be computed by the app (it is keyed by VISITOR_PII_KEY),
-- so rows registered before this migration have NULL lookups and cannot authenticate until their
-- credential is rotated (POST /v1/visitor/devices/:deviceId/rotate-credential). Those tokens have to
-- be rotated anyway because they were exposed in _outbox.messages (see 0018, UAT FQ9 #31).
--
-- Idempotent (IF NOT EXISTS). Additive, nullable: safe for running code.
-- Rollback:
--   DROP INDEX IF EXISTS visitor.idx_devices_old_token_lookup;
--   DROP INDEX IF EXISTS visitor.idx_devices_device_token_lookup;
--   ALTER TABLE visitor.devices DROP COLUMN IF EXISTS old_token_lookup, DROP COLUMN IF EXISTS device_token_lookup;
ALTER TABLE visitor.devices ADD COLUMN IF NOT EXISTS device_token_lookup text;
ALTER TABLE visitor.devices ADD COLUMN IF NOT EXISTS old_token_lookup text;
CREATE INDEX IF NOT EXISTS idx_devices_device_token_lookup
  ON visitor.devices (device_token_lookup) WHERE device_token_lookup IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devices_old_token_lookup
  ON visitor.devices (old_token_lookup) WHERE old_token_lookup IS NOT NULL;
