-- 0006_redemptions_fulfilment.sql
-- Purpose: GAP-LOYALTY-REDEMPTIONS-02 — a pending redemption (points held, reward
--          not yet handed over) can now be FULFILLED or REJECTED by a loyalty admin.
--          Adds the audit columns for the two outcomes and widens the status
--          allowlist with 'rejected' (a widening cannot invalidate stored rows).
-- Affected services: loyalty-service (POST /v1/loyalty/redemptions/:id/fulfil,
--                    POST /v1/loyalty/redemptions/:id/reject, GET /v1/loyalty/redemptions)
--
-- Rollback:
--   -- Only safe once no row is in status 'rejected':
--   ALTER TABLE loyalty.redemptions DROP CONSTRAINT IF EXISTS loyalty_redemptions_status_check;
--   ALTER TABLE loyalty.redemptions ADD CONSTRAINT loyalty_redemptions_status_check
--     CHECK (status IN ('pending','fulfilled','cancelled','expired','voided'));
--   ALTER TABLE loyalty.redemptions
--     DROP COLUMN IF EXISTS fulfilled_at, DROP COLUMN IF EXISTS fulfilled_by,
--     DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS reject_reason;

SET lock_timeout = '5s';

ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS fulfilled_at  timestamptz;
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS fulfilled_by  uuid;
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS rejected_at   timestamptz;
ALTER TABLE loyalty.redemptions ADD COLUMN IF NOT EXISTS reject_reason varchar(500);

ALTER TABLE loyalty.redemptions DROP CONSTRAINT IF EXISTS loyalty_redemptions_status_check;
ALTER TABLE loyalty.redemptions ADD CONSTRAINT loyalty_redemptions_status_check
  CHECK (status IN ('pending','fulfilled','cancelled','expired','voided','rejected'));
