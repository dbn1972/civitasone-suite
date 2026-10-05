-- Purpose: GAP-CRM-SERVICE-REQUESTS-NEW-03.
--   A service request had no record of HOW it was received (walk-in, phone,
--   portal, email, letter). The intake channel is needed for SLA/channel
--   reporting and to tell a self-service portal request from a counter one. Add
--   an optional, CHECK-constrained `intake_channel` column (nullable so existing
--   rows are valid and the field stays optional at intake).
-- Rollback: ALTER TABLE crm.service_requests DROP COLUMN IF EXISTS intake_channel;
-- Affected services: crm-service (service-requests module)

SET lock_timeout = '5s';

ALTER TABLE crm.service_requests
  ADD COLUMN IF NOT EXISTS intake_channel varchar(16);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_intake_channel_check'
  ) THEN
    ALTER TABLE crm.service_requests
      ADD CONSTRAINT service_requests_intake_channel_check
      CHECK (intake_channel IS NULL OR intake_channel IN ('walk_in', 'phone', 'portal', 'email', 'letter'));
  END IF;
END $$;
