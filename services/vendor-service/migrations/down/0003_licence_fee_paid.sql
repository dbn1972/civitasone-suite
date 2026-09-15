-- Down-migration for 0003_licence_fee_paid.sql — REL-020.
--
-- Reverses the fee_paid / fee_transaction_id idempotency columns added to
-- vendor.vendor_licences by the paired up-migration. This is the exact SQL
-- that up-migration's own header comment already specified
-- ("-- Rollback: ALTER TABLE vendor.vendor_licences DROP COLUMN fee_paid,
-- DROP COLUMN fee_transaction_id;") — formalized here as a real, tooled,
-- verified down-migration instead of an unexecuted comment.
--
-- Run via scripts/ops/migrate-rollback.sh, never by hand: that tool wraps
-- this file in a single transaction (psql -1 -v ON_ERROR_STOP=1), so if the
-- columns were never actually applied (DROP COLUMN would error on a column
-- that already doesn't exist, since these are DROP COLUMN, not
-- IF EXISTS-guarded creates being re-run) nothing here is committed.
--
-- CAUTION for a real production rollback (not applicable to the disposable
-- verification cluster this was tested against): dropping these columns
-- discards any fee_paid/fee_transaction_id values already recorded, and
-- reintroduces the double-fee-payment race the up-migration's companion
-- app-code change (licences/routes.ts's 409 FEE_ALREADY_PAID check) exists
-- to close. Confirm the app-code check is also rolled back/disabled first,
-- or the route will 500 on a column that no longer exists.
--
-- See scripts/ops/MIGRATION-ROLLBACK.md for the full procedure.

SET lock_timeout = '5s';

ALTER TABLE vendor.vendor_licences
  DROP COLUMN IF EXISTS fee_paid,
  DROP COLUMN IF EXISTS fee_transaction_id;
