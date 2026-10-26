-- Purpose: V4-C-04 -- allotment_number and lifecycle request_number were built
-- from crypto.randomInt(1, 999999) into fleet-global UNIQUE columns
-- (market_allotments.allotment_number, market_lifecycle_requests.request_number),
-- so birthday collisions (~50% at ~1200 records) made the consumer insert fail
-- AFTER the caller had already received 202. Replaced by one Postgres SEQUENCE
-- per column, drawn with nextval() inside the consumer transaction.
-- Scope: GLOBAL sequences (the columns are global-unique and the old counter
-- took no tenant argument). Seeded one past the highest existing trailing
-- number so already-issued numbers cannot be re-issued. Idempotent: the seed
-- is GREATEST(current last_value, max+1) so re-applying never moves it back.
-- Rollback:
--   DROP SEQUENCE IF EXISTS market.allotment_number_seq;
--   DROP SEQUENCE IF EXISTS market.lifecycle_request_number_seq;
--   (then revert the application change, which calls nextval on them)
-- Affected services: market-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS market.allotment_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS market.lifecycle_request_number_seq START 1;

-- The seed reads FORCE-RLS tables as their owner, which would otherwise see zero
-- rows (no tenant GUC): lift FORCE for the read, restore it right after.
ALTER TABLE market.market_allotments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE market.market_lifecycle_requests NO FORCE ROW LEVEL SECURITY;

SELECT setval(
  'market.allotment_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM market.allotment_number_seq),
    COALESCE((SELECT MAX((regexp_match(allotment_number, '(\d+)$'))[1]::bigint)
                FROM market.market_allotments), 0)
  ) + 1,
  false);

SELECT setval(
  'market.lifecycle_request_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM market.lifecycle_request_number_seq),
    COALESCE((SELECT MAX((regexp_match(request_number, '(\d+)$'))[1]::bigint)
                FROM market.market_lifecycle_requests), 0)
  ) + 1,
  false);

ALTER TABLE market.market_allotments FORCE ROW LEVEL SECURITY;
ALTER TABLE market.market_lifecycle_requests FORCE ROW LEVEL SECURITY;
