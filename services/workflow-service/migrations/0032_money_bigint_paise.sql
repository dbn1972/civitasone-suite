-- 0032_money_bigint_paise.sql
-- Purpose: Convert authority_limits.max_amount from numeric(18,2) to bigint (paise)
-- per CivitasOne standard: "Money: bigint paise — never loses precision above 2^53"
--
-- Rollback: ALTER TABLE workflow.authority_limits ALTER COLUMN max_amount TYPE numeric(18,2);
--
-- Affected services: workflow-service (authority module)
-- Table is empty in all environments — safe for direct ALTER.

SET lock_timeout = '5s';

-- Convert max_amount from numeric(18,2) to bigint (stores paise: ₹10,00,000 → 100000000)
ALTER TABLE workflow.authority_limits
  ALTER COLUMN max_amount TYPE bigint USING (max_amount * 100)::bigint;
