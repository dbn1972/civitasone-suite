-- 0086_offer_joining_extension.sql
-- Selection & offer — joining-date extension with approval (checklist R-RA-0165).
--   An accepted offer's joining date can be extended via a request → approve/reject
--   flow, preserving the original date. Offer analytics (R-RA-0167) is read-only.
-- Additive + idempotent. Extends recruitment.hrms_offers.
--
-- Rollback: ALTER TABLE recruitment.hrms_offers DROP COLUMN joining_extension_status, ...;

ALTER TABLE recruitment.hrms_offers
  ADD COLUMN IF NOT EXISTS joining_extension_status varchar(16) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS requested_joining_date   date,
  ADD COLUMN IF NOT EXISTS original_joining_date    date,     -- snapshot at first extension request
  ADD COLUMN IF NOT EXISTS joining_extension_reason text,
  ADD COLUMN IF NOT EXISTS requested_by             uuid,     -- maker (who asked for the extension)
  ADD COLUMN IF NOT EXISTS requested_at             timestamptz,
  ADD COLUMN IF NOT EXISTS joining_extension_by     uuid,     -- checker (who approved/rejected)
  ADD COLUMN IF NOT EXISTS joining_extension_at     timestamptz;

ALTER TABLE recruitment.hrms_offers
  DROP CONSTRAINT IF EXISTS hrms_offers_joining_extension_status_check;
ALTER TABLE recruitment.hrms_offers
  ADD CONSTRAINT hrms_offers_joining_extension_status_check
  CHECK (joining_extension_status IN ('none','requested','approved','rejected'));
