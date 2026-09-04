-- Purpose: Add fee_paid / fee_transaction_id idempotency columns to
-- vendor.vendor_licences, mirroring vendor_registrations (which already
-- has them, migrations/0001_initial.sql) and trade-service's applications
-- table (services/trade-service/migrations, the fleet reference for this
-- pattern).
--
-- POST /v1/vendor/licences/:id/fee-payment (licences/routes.ts) had no
-- idempotency check at all -- unlike every sibling service's equivalent
-- fee-payment route -- because vendor_licences never had a fee_paid column
-- to check in the first place: the recordLicenceFee consumer
-- (licences/consumer.ts) only ever published an event and wrote an audit
-- row, with no persisted state a route-level pre-check could read. A client
-- retry (or two racing double-clicks) republished the command indefinitely
-- with nothing to stop it.
--
-- This migration is half of the fix -- see the paired application-code
-- change in licences/routes.ts (existing.feePaid -> 409 FEE_ALREADY_PAID)
-- and licences/repo.ts's updateFeePayment (the persistence half, called
-- from the recordLicenceFee consumer).
--
-- Rollback: ALTER TABLE vendor.vendor_licences DROP COLUMN fee_paid, DROP COLUMN fee_transaction_id;
-- Affected services: vendor-service

SET lock_timeout = '5s';

ALTER TABLE vendor.vendor_licences
  ADD COLUMN IF NOT EXISTS fee_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fee_transaction_id varchar(128);
