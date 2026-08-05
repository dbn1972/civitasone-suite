-- Purpose: OP-003 — opportunity attributes required for pipeline progression:
--   product, quantity, competitors, next step and an explicit expected close date
--   (distinct from close_date, which the forecast/close path already owns). The
--   stage-change route enforces the target stage's mandatory_fields against these
--   before it will accept a progression.
-- Rollback: ALTER TABLE crm.deals DROP COLUMN IF EXISTS product, DROP COLUMN IF EXISTS
--   quantity, DROP COLUMN IF EXISTS competitors, DROP COLUMN IF EXISTS next_step,
--   DROP COLUMN IF EXISTS expected_close_date;
-- Affected services: crm-service (deals module)

SET lock_timeout = '5s';

ALTER TABLE crm.deals
  ADD COLUMN IF NOT EXISTS product             varchar(160),
  ADD COLUMN IF NOT EXISTS quantity            integer CHECK (quantity IS NULL OR quantity >= 0),
  ADD COLUMN IF NOT EXISTS competitors         jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS next_step           text,
  ADD COLUMN IF NOT EXISTS expected_close_date date;
