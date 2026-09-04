-- Purpose: Close a money-precision-loss bug found during Wave 2 hardening
-- review of sewerage-service: amount_minor (sewerage_bills) and fee_minor
-- (sewerage_desludging_bookings) were declared `integer` (max ~2.147bn),
-- and their route-facing Zod schemas were plain `z.number().int()` with no
-- upper bound -- any value already above Number.MAX_SAFE_INTEGER (2^53)
-- that reached this layer had already lost precision in JS before ever
-- being cast to a DB integer, and even a legitimate safe-integer value
-- above ~21.4 lakh rupees (2.147bn paise) would overflow the int4 column
-- outright. Same bug class already closed for parking-service's
-- tariff/pass fields (migrations under services/parking-service, PR #1005)
-- and citizen-service's fee module (0018_money_bigint_paise.sql).
--
-- Fix (this migration is half of it -- see the paired application-code
-- change in billing/routes.ts and desludging/routes.ts, both now using
-- @civitasone/schemas' zMoneyMinorStringNonNeg codec so the value is
-- carried end-to-end as a bounded, exact base-10 STRING and never
-- round-trips through a JS `number`): widen both columns from `integer` to
-- `bigint`, matching the bigint the codec's paired consumer-side
-- BigInt(string) now produces.
--
-- Tables are empty in all environments -- sewerage-service's migrations
-- directory (and this service's first row ever) did not exist until
-- tonight's PR #988/#1000 -- safe for a direct ALTER, no USING clause
-- needed (int4 -> int8 is an implicit widening cast, no data loss possible).
--
-- Rollback:
--   ALTER TABLE civitas_sewerage.sewerage_bills ALTER COLUMN amount_minor TYPE integer;
--   ALTER TABLE civitas_sewerage.sewerage_desludging_bookings ALTER COLUMN fee_minor TYPE integer;
-- Affected services: sewerage-service

SET lock_timeout = '5s';

ALTER TABLE civitas_sewerage.sewerage_bills
  ALTER COLUMN amount_minor TYPE bigint;

ALTER TABLE civitas_sewerage.sewerage_desludging_bookings
  ALTER COLUMN fee_minor TYPE bigint;
