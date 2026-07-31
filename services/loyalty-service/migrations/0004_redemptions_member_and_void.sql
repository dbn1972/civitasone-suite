-- 0004_redemptions_member_and_void.sql
-- Purpose: Make loyalty.redemptions writable by the current application code.
--          (1) member_id was created NOT NULL in 0001 as the denormalised link
--              to the CDP profile. 0002 introduced enrolment_id as the modern
--              link, and rows created through the enrolment path may not know
--              the profile id, so member_id becomes optional. Dropping NOT NULL
--              is a constraint RELAXATION — every existing row stays valid.
--          (2) redemptions/repo.ts voidRedemption() writes status = 'voided',
--              a value the 0001 allowlist never included, so every void was
--              rejected by loyalty_redemptions_status_check. The allowlist is
--              widened; widening an allowlist cannot invalidate stored rows.
-- Affected services: loyalty-service (POST /v1/loyalty/redeem,
--                    POST /v1/loyalty/redemptions/:id/void)
--
-- Rollback:
--   -- Only safe once every row has a non-null member_id:
--   ALTER TABLE loyalty.redemptions ALTER COLUMN member_id SET NOT NULL;
--   -- Only safe once no row is in status 'voided':
--   ALTER TABLE loyalty.redemptions DROP CONSTRAINT IF EXISTS loyalty_redemptions_status_check;
--   ALTER TABLE loyalty.redemptions ADD CONSTRAINT loyalty_redemptions_status_check
--     CHECK (status IN ('pending','fulfilled','cancelled','expired'));

SET lock_timeout = '5s';

-- ── (1) member_id becomes optional ─────────────────────────────────────────
-- DROP NOT NULL is a no-op when the column is already nullable, so the whole
-- file stays re-runnable.
ALTER TABLE loyalty.redemptions ALTER COLUMN member_id DROP NOT NULL;

-- ── (2) 'voided' joins the status allowlist ────────────────────────────────
ALTER TABLE loyalty.redemptions DROP CONSTRAINT IF EXISTS loyalty_redemptions_status_check;
ALTER TABLE loyalty.redemptions ADD CONSTRAINT loyalty_redemptions_status_check
  CHECK (status IN ('pending','fulfilled','cancelled','expired','voided'));
