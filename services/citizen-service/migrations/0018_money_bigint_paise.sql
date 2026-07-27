-- 0018_money_bigint_paise.sql
-- Purpose: Convert money columns from numeric(14,2) to bigint (paise/minor units)
-- per CivitasOne standard: "Money: bigint paise — never loses precision above 2^53"
--
-- Rollback: ALTER TABLE fee.schedules ALTER COLUMN base_amount TYPE numeric(14,2);
--           ALTER TABLE fee.payments ALTER COLUMN amount TYPE numeric(14,2);
--           ALTER TABLE fee.refunds ALTER COLUMN amount TYPE numeric(14,2);
--
-- Affected services: citizen-service (fee module)
-- Tables are empty in all environments — safe for direct ALTER.

SET lock_timeout = '5s';

-- Convert base_amount from numeric(14,2) to bigint (stores paise: ₹100.50 → 10050)
ALTER TABLE fee.schedules
  ALTER COLUMN base_amount TYPE bigint USING (base_amount * 100)::bigint;

ALTER TABLE fee.schedules
  ALTER COLUMN base_amount SET DEFAULT 0;

-- Convert payments.amount from numeric(14,2) to bigint
ALTER TABLE fee.payments
  ALTER COLUMN amount TYPE bigint USING (amount * 100)::bigint;

-- Convert refunds.amount from numeric(14,2) to bigint
ALTER TABLE fee.refunds
  ALTER COLUMN amount TYPE bigint USING (amount * 100)::bigint;
