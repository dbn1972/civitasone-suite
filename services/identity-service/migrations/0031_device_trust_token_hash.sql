-- 0031_device_trust_token_hash.sql — FQ12-SEC: stop storing device trust
-- tokens in plaintext.
--
-- WHY: devices.registered_devices.trust_token held the raw bearer token that
-- POST /v1/devices/step-up compares against the x-device-trust-token header
-- (UAT runner: 88 plaintext rows on civitas_identity). It is a secret used
-- only for comparison, so only its SHA-256 is kept; the service now writes
-- trust_token_hash and compares with timingSafeEqual (devices/repo.ts).
--
-- Steps (all guarded; re-running is a no-op):
--   1. ADD COLUMN trust_token_hash (nullable) IF NOT EXISTS.
--   2. While trust_token still exists: backfill trust_token_hash =
--      sha256(trust_token) for rows that lack it, then DROP trust_token.
--      Done inside ONE DO block (one transaction) so the plaintext column is
--      never dropped before every row has its hash.
--   3. SET NOT NULL on trust_token_hash once no NULLs remain.
--
-- RLS: the table is FORCE ROW LEVEL SECURITY (migrations 0012/0013) and no
-- tenant GUC is set while migrating, so an UPDATE by the table owner would see
-- ZERO rows. The DO block lifts FORCE for its own duration and restores it
-- before it ends (the owner/superuser running migrations bypasses RLS while
-- FORCE is off). It is the same single transaction, so no other session ever
-- observes the table without FORCE. A superuser bypasses RLS regardless.
--
-- Hash format: lowercase hex SHA-256 of the UTF-8 token — identical to
-- devices/repo.ts#hashTrustToken, so existing devices keep working.
--
-- Deploy: apply together with the identity API + worker build that reads
-- trust_token_hash (old code reads/writes trust_token, which this drops).

SET lock_timeout = '5s';

ALTER TABLE devices.registered_devices ADD COLUMN IF NOT EXISTS trust_token_hash TEXT;

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'devices' AND table_name = 'registered_devices' AND column_name = 'trust_token'
  ) THEN
    ALTER TABLE devices.registered_devices NO FORCE ROW LEVEL SECURITY;

    EXECUTE $q$
      UPDATE devices.registered_devices
         SET trust_token_hash = encode(sha256(convert_to(trust_token, 'UTF8')), 'hex')
       WHERE trust_token_hash IS NULL AND trust_token IS NOT NULL
    $q$;

    IF EXISTS (SELECT 1 FROM devices.registered_devices WHERE trust_token_hash IS NULL) THEN
      RAISE EXCEPTION 'registered_devices: rows without a trust token hash remain; refusing to drop trust_token';
    END IF;

    ALTER TABLE devices.registered_devices DROP COLUMN trust_token;
    ALTER TABLE devices.registered_devices FORCE ROW LEVEL SECURITY;
  END IF;
END
$body$;

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'devices' AND table_name = 'registered_devices'
       AND column_name = 'trust_token_hash' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE devices.registered_devices ALTER COLUMN trust_token_hash SET NOT NULL;
  END IF;
END
$body$;
