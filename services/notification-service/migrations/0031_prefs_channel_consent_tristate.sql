-- Purpose: R1 follow-up — restore TRI-STATE consent on the two commercial
--          channels so "no choice recorded" is distinguishable from "explicit
--          opt-out".
--
--          Migration 0029 added templates.prefs.sms / .whatsapp as
--          NOT NULL DEFAULT false. That collapsed two different facts into one
--          value: a recipient who had never been asked looked identical to a
--          recipient who refused. The send gate read both as "no consent" and
--          refused SMS even for TRANSACTIONAL traffic, which re-routed
--          court-service login OTPs and visitor-service evacuation alerts onto
--          the email fallback with a phone number as the address.
--
--          After this migration:
--            NULL  = no choice recorded  → allowed for transactional sms/whatsapp,
--                                          refused for marketing (TRAI/DLT opt-in)
--            false = explicit opt-out    → refused on every send, both kinds
--            true  = explicit opt-in     → allowed
--
-- Rollback: UPDATE templates.prefs SET sms      = false WHERE sms      IS NULL;
--           UPDATE templates.prefs SET whatsapp = false WHERE whatsapp IS NULL;
--           ALTER TABLE templates.prefs
--             ALTER COLUMN sms      SET DEFAULT false, ALTER COLUMN sms      SET NOT NULL,
--             ALTER COLUMN whatsapp SET DEFAULT false, ALTER COLUMN whatsapp SET NOT NULL;
-- Affected services: notification-service (templates prefs module, deliveries consent gate, bulk fan-out)
--
-- Safety: additive + idempotent. DROP NOT NULL / DROP DEFAULT are catalogue-only
-- (no table rewrite). The one-time backfill is guarded on the 0029 default still
-- being present: `scripts/dev/migrate-all.mjs` keeps no applied-migration ledger
-- and re-runs every file, so without that guard a later re-run would erase
-- genuine opt-outs recorded as `false`. Once the default is gone the backfill
-- cannot fire again.
SET lock_timeout = '5s';

DO $$
DECLARE
  has_0029_default boolean;
BEGIN
  -- Read the marker BEFORE relaxing the column: dropping the default is what
  -- clears it, so this must be captured first or the backfill below could never
  -- be distinguished from a re-run.
  SELECT column_default IS NOT NULL INTO has_0029_default
  FROM information_schema.columns
  WHERE table_schema = 'templates' AND table_name = 'prefs' AND column_name = 'sms';

  -- Column absent → 0029 has not run yet; nothing to relax.
  IF has_0029_default IS NULL THEN
    RETURN;
  END IF;

  -- Relax the constraint FIRST. The backfill writes NULL, which the 0029
  -- NOT NULL would reject.
  ALTER TABLE templates.prefs
    ALTER COLUMN sms      DROP DEFAULT,
    ALTER COLUMN sms      DROP NOT NULL,
    ALTER COLUMN whatsapp DROP DEFAULT,
    ALTER COLUMN whatsapp DROP NOT NULL;

  -- Reclaim the 0029 backfill as "no choice recorded". Every `false` in these
  -- columns at this point was written by the 0029 column default or by the
  -- `?? false` coalesce in the setPrefs consumer, both introduced in the same
  -- unreleased change, so none of them is a recipient decision. One-shot: on a
  -- re-run the default is already gone, so genuine opt-outs are never erased.
  IF has_0029_default THEN
    UPDATE templates.prefs SET sms      = NULL WHERE sms      = false;
    UPDATE templates.prefs SET whatsapp = NULL WHERE whatsapp = false;
  END IF;
END $$;

COMMENT ON COLUMN templates.prefs.sms IS
  'Tri-state commercial consent: NULL = no choice recorded, false = explicit opt-out, true = opt-in.';
COMMENT ON COLUMN templates.prefs.whatsapp IS
  'Tri-state commercial consent: NULL = no choice recorded, false = explicit opt-out, true = opt-in.';
