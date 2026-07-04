-- 0009_plans_bigint_price.sql
-- M1: Widen plans.price_minor from INTEGER to BIGINT.
-- INTEGER overflows at ₹21.5 lakhs (2,147,483,647 paise = ₹2.15 crore actually,
-- but annual enterprise plans can exceed 32-bit when multiplied by seat count).
-- Idempotent (ALTER COLUMN TYPE is a no-op if already bigint).

ALTER TABLE plans.plans
  ALTER COLUMN price_minor TYPE bigint;
