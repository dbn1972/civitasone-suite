-- Purpose: V4-C-04 -- reference numbers in this service were built from
-- crypto.randomInt(1, 999999) into fleet-global UNIQUE columns, so birthday
-- collisions (~50% at ~1200 records) made the consumer insert fail AFTER the
-- caller had already received 202. Replaced by one Postgres SEQUENCE per
-- column, drawn with nextval() inside the consumer transaction.
-- Scope: GLOBAL sequences (the columns are global-unique and the old counter
-- took no tenant argument). Seeded one past the highest existing trailing
-- number so already-issued numbers cannot be re-issued. Idempotent: the seed
-- is GREATEST(current last_value, max+1) so re-applying never moves it back.
-- Rollback:
--   DROP SEQUENCE IF EXISTS trade.application_number_seq;
--   DROP SEQUENCE IF EXISTS trade.licence_number_seq;
--   (then revert the application change, which calls nextval on them)
-- Affected services: trade-service

SET lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS trade.application_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS trade.licence_number_seq START 1;

-- The seed reads FORCE-RLS tables as their owner, which would otherwise see zero
-- rows (no tenant GUC): lift FORCE for the read, restore it right after.
ALTER TABLE trade.trade_applications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE trade.trade_licences NO FORCE ROW LEVEL SECURITY;

SELECT setval(
  'trade.application_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM trade.application_number_seq),
    COALESCE((SELECT MAX((regexp_match(application_number, '(\d+)$'))[1]::bigint)
                FROM trade.trade_applications), 0)
  ) + 1,
  false);

SELECT setval(
  'trade.licence_number_seq',
  GREATEST(
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM trade.licence_number_seq),
    COALESCE((SELECT MAX((regexp_match(licence_number, '(\d+)$'))[1]::bigint)
                FROM trade.trade_licences), 0)
  ) + 1,
  false);

ALTER TABLE trade.trade_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE trade.trade_licences FORCE ROW LEVEL SECURITY;
