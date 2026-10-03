-- 0058_fnf_death_settlement_nominee.sql
-- GAP-PAYROLL-FNF-05: a death settlement has no employee to pay -- the money
-- goes to the nominee / legal heir. Until now the compute form had no payee
-- fields, so who was being paid for a death separation was not recorded
-- anywhere on the settlement.
--
-- Columns (all nullable; only a 'death' settlement carries them):
--   nominee_name / nominee_relationship  who is paid and how they relate
--   nominee_ifsc / nominee_account_last4 payee bank, display tail only
--   nominee_account_sealed               the full account number, sealed with
--                                        the service's PII key (encryptPii,
--                                        AES-256-GCM "enc:v2:" envelope); it
--                                        is never returned by any API
--   nominee_document_ref                 legal-heir certificate / succession
--                                        certificate / nomination reference
--
-- CHECKs are NOT VALID so settlements computed before this migration (which
-- may be 'death' rows without a payee) are not rewritten; every NEW or
-- UPDATED row is checked. The API (zod) enforces the same rule first.
--
-- Rollback:
--   ALTER TABLE payroll.fnf_settlements
--     DROP CONSTRAINT IF EXISTS fnf_settlements_death_nominee_check,
--     DROP CONSTRAINT IF EXISTS fnf_settlements_nominee_ifsc_check,
--     DROP COLUMN IF EXISTS nominee_name, DROP COLUMN IF EXISTS nominee_relationship,
--     DROP COLUMN IF EXISTS nominee_ifsc, DROP COLUMN IF EXISTS nominee_account_last4,
--     DROP COLUMN IF EXISTS nominee_account_sealed, DROP COLUMN IF EXISTS nominee_document_ref;
SET lock_timeout = '5s';

ALTER TABLE payroll.fnf_settlements
  ADD COLUMN IF NOT EXISTS nominee_name           varchar(128),
  ADD COLUMN IF NOT EXISTS nominee_relationship   varchar(32),
  ADD COLUMN IF NOT EXISTS nominee_ifsc           varchar(11),
  ADD COLUMN IF NOT EXISTS nominee_account_last4  varchar(4),
  ADD COLUMN IF NOT EXISTS nominee_account_sealed text,
  ADD COLUMN IF NOT EXISTS nominee_document_ref   varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'fnf_settlements_nominee_ifsc_check'
                    AND conrelid = 'payroll.fnf_settlements'::regclass) THEN
    ALTER TABLE payroll.fnf_settlements
      ADD CONSTRAINT fnf_settlements_nominee_ifsc_check
      CHECK (nominee_ifsc IS NULL OR nominee_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'fnf_settlements_death_nominee_check'
                    AND conrelid = 'payroll.fnf_settlements'::regclass) THEN
    ALTER TABLE payroll.fnf_settlements
      ADD CONSTRAINT fnf_settlements_death_nominee_check
      CHECK (separation_type <> 'death' OR (
        nominee_name IS NOT NULL AND nominee_relationship IS NOT NULL
        AND nominee_ifsc IS NOT NULL AND nominee_account_sealed IS NOT NULL
        AND nominee_document_ref IS NOT NULL
      )) NOT VALID;
  END IF;
END $$;
