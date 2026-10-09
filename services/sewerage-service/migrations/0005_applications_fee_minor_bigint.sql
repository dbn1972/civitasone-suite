-- GAP2-PLATFORM-MONEY-INT-02: widen sewerage_applications.fee_minor from
-- `integer` (int4, max ~₹2.14 crore in paise) to `bigint` (int8), closing the
-- same money-precision/overflow bug class already fixed for this service's
-- sibling tables in 0002_money_bigint_paise.sql — which widened
-- sewerage_bills.amount_minor and sewerage_desludging_bookings.fee_minor but
-- MISSED sewerage_applications.fee_minor. Money is bigint paise end to end
-- (see the paired Drizzle model change in
-- src/modules/connections/schema.ts, now bigint mode, and connections/repo.ts
-- appToView, which serialises it as a canonical base-10 string).
--
-- int4 -> int8 is a lossless implicit widening cast, so no USING clause is
-- needed. Additive and idempotent: the ALTER is a no-op if the column is
-- already bigint (re-running TYPE bigint on a bigint column changes nothing).
--
-- Rollback:
--   ALTER TABLE civitas_sewerage.sewerage_applications ALTER COLUMN fee_minor TYPE integer;
-- Affected services: sewerage-service

SET lock_timeout = '5s';

ALTER TABLE civitas_sewerage.sewerage_applications
  ALTER COLUMN fee_minor TYPE bigint;
