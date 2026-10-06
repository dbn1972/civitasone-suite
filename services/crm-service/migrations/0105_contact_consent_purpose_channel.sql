-- Purpose: GAP-CRM-CONTACTS-DETAIL-EDIT-07.
--   DPDP marketing consent was stored as a bare boolean (marketing_consent) plus
--   a consent_date, with no record of the PURPOSE consent was given for or the
--   CHANNEL it was captured through — both required for a defensible DPDP consent
--   artefact (purpose limitation + proof of how/when it was collected). Add two
--   optional, CHECK-constrained columns plus a precise consent_updated_at
--   timestamp (consent_date is a bare date; the timestamp records the exact
--   instant the consent state last changed). All nullable so existing rows stay
--   valid and the fields remain optional unless marketing_consent is granted
--   (the application requires purpose+channel on grant; the DB stays permissive
--   for backfill/import rows and prior data).
-- Rollback:
--   ALTER TABLE crm.contacts DROP COLUMN IF EXISTS consent_purpose;
--   ALTER TABLE crm.contacts DROP COLUMN IF EXISTS consent_channel;
--   ALTER TABLE crm.contacts DROP COLUMN IF EXISTS consent_updated_at;
-- Affected services: crm-service (contacts module)

SET lock_timeout = '5s';

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS consent_purpose varchar(32);

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS consent_channel varchar(16);

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS consent_updated_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_consent_purpose_check'
  ) THEN
    ALTER TABLE crm.contacts
      ADD CONSTRAINT contacts_consent_purpose_check
      CHECK (consent_purpose IS NULL OR consent_purpose IN ('marketing', 'transactional', 'service_updates', 'research'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_consent_channel_check'
  ) THEN
    ALTER TABLE crm.contacts
      ADD CONSTRAINT contacts_consent_channel_check
      CHECK (consent_channel IS NULL OR consent_channel IN ('web_form', 'email', 'phone', 'in_person', 'import'));
  END IF;
END $$;
