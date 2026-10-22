-- Purpose: GAP-CRM-SERVICE-REQUESTS-DETAIL-04.
--   Resolving or closing a service request enqueues a citizen notification, but the
--   outcome (sent / failed / no template configured / no contact on file) was only
--   written to an activity and an audit event, so the officer who resolved the
--   request had no way to see whether the citizen was actually told. Record the
--   channel, the outcome and when it was reached on the request itself so the detail
--   page and the status PATCH response can say so honestly.
--   All three columns are nullable: NULL on every row that predates this change and on
--   any request that has never been resolved/closed. Writing them does NOT touch
--   version/updated_at, so a delivery result never makes an officer's open page stale.
-- Rollback: ALTER TABLE crm.service_requests
--             DROP COLUMN IF EXISTS citizen_notify_channel,
--             DROP COLUMN IF EXISTS citizen_notify_outcome,
--             DROP COLUMN IF EXISTS citizen_notified_at;
-- Affected services: crm-service (service-requests module)
-- Sequencing: additive, no backfill; deploy the migration before the new crm-service.

SET lock_timeout = '5s';

ALTER TABLE crm.service_requests
  ADD COLUMN IF NOT EXISTS citizen_notify_channel varchar(8),
  ADD COLUMN IF NOT EXISTS citizen_notify_outcome varchar(24),
  ADD COLUMN IF NOT EXISTS citizen_notified_at    timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_citizen_notify_channel_check'
  ) THEN
    ALTER TABLE crm.service_requests
      ADD CONSTRAINT service_requests_citizen_notify_channel_check
      CHECK (citizen_notify_channel IS NULL OR citizen_notify_channel IN ('email', 'sms'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_citizen_notify_outcome_check'
  ) THEN
    ALTER TABLE crm.service_requests
      ADD CONSTRAINT service_requests_citizen_notify_outcome_check
      CHECK (citizen_notify_outcome IS NULL
             OR citizen_notify_outcome IN ('sent', 'failed', 'no_template', 'no_contact'));
  END IF;
END $$;
