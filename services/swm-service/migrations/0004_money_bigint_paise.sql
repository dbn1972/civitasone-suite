-- GAP2-PLATFORM-MONEY-INT-02: widen the two swm money minor-unit columns from
-- `integer` (int4, max ~₹2.14 crore in paise) to `bigint` (int8). swm-service
-- had no money-widening migration at all — both columns were declared
-- `integer` in 0001_swm_schema.sql (swm_bulk_generators.fee_minor:92,
-- swm_collection_requests.fee_minor:127) and the Drizzle models matched. This
-- closes the same overflow bug class already fixed for sewerage-service
-- (0002_money_bigint_paise.sql) and citizen-service. Money is bigint paise end
-- to end (see the paired Drizzle model changes in
-- src/modules/bulk_generators/schema.ts and src/modules/collection/schema.ts,
-- now bigint mode; the fee rate tables in each module's domain.ts now return
-- bigint, and the repo views serialise fee_minor as a canonical base-10
-- string).
--
-- int4 -> int8 is a lossless implicit widening cast, so no USING clause is
-- needed. Additive and idempotent: ALTER ... TYPE bigint on an
-- already-bigint column is a no-op, so this is safe to re-run.
--
-- Rollback:
--   ALTER TABLE civitas_swm.swm_bulk_generators ALTER COLUMN fee_minor TYPE integer;
--   ALTER TABLE civitas_swm.swm_collection_requests ALTER COLUMN fee_minor TYPE integer;
-- Affected services: swm-service

SET lock_timeout = '5s';

ALTER TABLE civitas_swm.swm_bulk_generators
  ALTER COLUMN fee_minor TYPE bigint;

ALTER TABLE civitas_swm.swm_collection_requests
  ALTER COLUMN fee_minor TYPE bigint;
