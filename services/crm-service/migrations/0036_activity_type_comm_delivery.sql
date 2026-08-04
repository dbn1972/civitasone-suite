-- Purpose: Add 'comm_delivery' to crm.activities.type CHECK constraint. Closes an
--   orphan loop: notification-service publishes notification.delivery.to_crm
--   (channels/crm-timeline-routes.ts) to record a delivery event on a contact's
--   activity timeline, but activities_type_check (migration 0010) only allowed
--   ('call','meeting','email','task','note','complaint') — the insert would
--   have failed the CHECK constraint. type stays varchar(16); 'comm_delivery'
--   (13 chars) fits.
-- Rollback: ALTER TABLE crm.activities DROP CONSTRAINT IF EXISTS activities_type_check;
--           ALTER TABLE crm.activities ADD CONSTRAINT activities_type_check
--             CHECK (type IN ('call','meeting','email','task','note','complaint')) NOT VALID;
--           ALTER TABLE crm.activities VALIDATE CONSTRAINT activities_type_check;
-- Affected services: crm-service (write path: modules/activities/notification-delivery-consumer.ts)

SET lock_timeout = '5s';

DO $$ BEGIN
  ALTER TABLE crm.activities DROP CONSTRAINT IF EXISTS activities_type_check;
  ALTER TABLE crm.activities
    ADD CONSTRAINT activities_type_check
    CHECK (type IN ('call', 'meeting', 'email', 'task', 'note', 'complaint', 'comm_delivery'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE crm.activities VALIDATE CONSTRAINT activities_type_check;
