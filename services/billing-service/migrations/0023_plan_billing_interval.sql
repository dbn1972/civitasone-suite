-- 0023_plan_billing_interval.sql
-- GAP-BILLING-PLANS-NEW-01 (UAT B4, owner decision 2026-10-27): a plan carries its billing
-- interval. NOT NULL with a default so every existing plan stays valid as monthly; the CHECK
-- limits it to the three intervals the product bills on. Column only, no new table: the
-- existing FORCE RLS policies on plans.billing_plans cover it.
-- Idempotent. Rollback: ALTER TABLE plans.billing_plans DROP COLUMN billing_interval;
-- Affected services: billing-service

SET lock_timeout = '5s';

ALTER TABLE plans.billing_plans
  ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(12) NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_billing_plans_interval') THEN
    ALTER TABLE plans.billing_plans ADD CONSTRAINT ck_billing_plans_interval
      CHECK (billing_interval IN ('monthly', 'quarterly', 'yearly')) NOT VALID;
    ALTER TABLE plans.billing_plans VALIDATE CONSTRAINT ck_billing_plans_interval;
  END IF;
END $$;
