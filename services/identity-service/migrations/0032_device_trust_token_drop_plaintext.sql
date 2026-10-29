-- 0032_device_trust_token_drop_plaintext.sql — FQ12-SEC (contract step):
-- drop the plaintext device trust token column.
--
-- APPLY ONLY AFTER the identity + identity-worker build that reads/writes
-- trust_token_hash (never trust_token) is deployed and verified (see 0031 and
-- the PR #2372 deploy order). The old build cannot run after this migration.
-- The drop is irreversible; take `pg_dump -t devices.registered_devices`
-- first if a rollback copy is wanted.
--
-- In one DO block (one transaction), only while trust_token still exists:
--   1. hash any row the OLD build wrote between 0031 and the new deploy
--      (hash NULL, plaintext present);
--   2. REFUSE (raise, nothing changed) while any row still has no hash —
--      dropping the column then would lose the only copy of that credential;
--   3. drop trust_token and SET NOT NULL on trust_token_hash.
-- Re-running after success is a no-op. FORCE RLS is lifted only inside the
-- block (no tenant GUC while migrating) and restored before it ends; an
-- exception rolls that back as well.

SET lock_timeout = '5s';

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

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'devices' AND table_name = 'registered_devices'
       AND column_name = 'trust_token_hash' AND is_nullable = 'YES'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'devices' AND table_name = 'registered_devices' AND column_name = 'trust_token'
  ) THEN
    ALTER TABLE devices.registered_devices ALTER COLUMN trust_token_hash SET NOT NULL;
  END IF;
END
$body$;
