-- 0021_money_bigint_paise.sql
-- Purpose: Convert RTI fee columns from numeric(12,2) to bigint (paise/minor units)
-- per CivitasOne standard: "Money: bigint paise — never loses precision above 2^53"
--
-- Rollback: ALTER TABLE rti.rti_applications ALTER COLUMN fee_paid TYPE numeric(12,2);
--           ALTER TABLE rti.rti_applications ALTER COLUMN additional_fee TYPE numeric(12,2);
--
-- Affected services: legal-service (RTI module)
-- Table is empty in all environments — safe for direct ALTER.

SET lock_timeout = '5s';

-- Convert fee_paid from numeric(12,2) to bigint (stores paise: ₹10.00 → 1000)
ALTER TABLE rti.rti_applications
  ALTER COLUMN fee_paid TYPE bigint USING (fee_paid * 100)::bigint;

ALTER TABLE rti.rti_applications
  ALTER COLUMN fee_paid SET DEFAULT 0;

-- Convert additional_fee from numeric(12,2) to bigint
ALTER TABLE rti.rti_applications
  ALTER COLUMN additional_fee TYPE bigint USING (additional_fee * 100)::bigint;

ALTER TABLE rti.rti_applications
  ALTER COLUMN additional_fee SET DEFAULT 0;
