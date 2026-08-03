-- Purpose: Persist deal close outcome details (OP-006). The close command carries a
--          mandatory loss reason and an optional realised value; without these columns
--          the consumer had nowhere to store them and the data was lost on close.
-- Rollback: ALTER TABLE crm.deals DROP COLUMN IF EXISTS close_reason,
--                                 DROP COLUMN IF EXISTS closed_value_minor;
-- Affected services: crm-service
-- Sequencing: additive and nullable — safe to apply before the code that writes it.

SET lock_timeout = '5s';

ALTER TABLE crm.deals ADD COLUMN IF NOT EXISTS close_reason text;
-- Realised amount in minor units (paise). Kept separate from value_minor so the
-- forecast value the deal carried while open is not overwritten on close.
ALTER TABLE crm.deals ADD COLUMN IF NOT EXISTS closed_value_minor bigint;
