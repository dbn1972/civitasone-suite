-- 0031_device_trust_token_hash.sql — FQ12-SEC (expand step): store a hash of
-- the device trust token alongside the legacy plaintext column.
--
-- WHY: devices.registered_devices.trust_token held the raw bearer token that
-- POST /v1/devices/step-up compares against the x-device-trust-token header
-- (UAT runner: 88 plaintext rows on civitas_identity). It is a secret used
-- only for comparison, so only its SHA-256 is needed; the new service build
-- writes/reads trust_token_hash only and compares with timingSafeEqual
-- (devices/repo.ts) — it never reads trust_token.
--
-- EXPAND / CONTRACT (deploy-safe, per the PR #2372 review):
--   0031 (this file) — add trust_token_hash, backfill it from trust_token,
--        and DROP NOT NULL on trust_token. trust_token is KEPT, so the OLD
--        build still runs after this migration, and the NEW build (which
--        never writes trust_token) can insert rows.
--   0032 — after the new identity + identity-worker build is live and
--        verified: hash any rows the old build wrote in between, refuse while
--        any row still has no hash, then drop trust_token.
--
-- Guarded and idempotent: ADD COLUMN IF NOT EXISTS; the backfill only touches
-- rows whose hash is NULL; every step is skipped once trust_token is gone.
--
-- RLS: the table is FORCE ROW LEVEL SECURITY (0012/0013) and no tenant GUC is
-- set while migrating, so an owner UPDATE would see ZERO rows. The DO block
-- lifts FORCE for its own duration and restores it before it ends; it is one
-- statement / one transaction, so no other session observes the table without
-- FORCE (an exception rolls the NO FORCE back too). A superuser bypasses RLS
-- regardless.
--
-- Hash format: lowercase hex SHA-256 of the UTF-8 token — identical to
-- devices/repo.ts#hashTrustToken, so existing devices keep working.

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

    -- The new build inserts rows without the plaintext column.
    ALTER TABLE devices.registered_devices ALTER COLUMN trust_token DROP NOT NULL;

    ALTER TABLE devices.registered_devices FORCE ROW LEVEL SECURITY;
  END IF;
END
$body$;
