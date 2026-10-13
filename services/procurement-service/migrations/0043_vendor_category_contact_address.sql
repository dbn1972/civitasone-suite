-- Migration 0043: vendor registration persists category, contact person, address.
--
-- w0-report.md (defect: vendor registration silently drops fields): the web
-- RegisterVendorForm posts category / contactPerson / address / bank account,
-- but the API schema stripped them and vendor.procurement_vendors had no
-- columns for three of them. Add them. contact_person and address hold
-- personal data and are written through the same app-layer AES-GCM envelope
-- (encryptedText) as pan/email/phone, so they are plain TEXT here.
-- category is the procurement category (goods | services | works), distinct
-- from vendor_type (the lifecycle: registered | empanelled | blacklisted).
-- The bank account number already has its column (bank_account).
--
-- Additive + idempotent. Existing table is already FORCE RLS + granted.
-- Rollback:
--   ALTER TABLE vendor.procurement_vendors
--     DROP COLUMN IF EXISTS category,
--     DROP COLUMN IF EXISTS contact_person,
--     DROP COLUMN IF EXISTS address;
-- Affected services: procurement-service (vendor module)

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE vendor.procurement_vendors
  ADD COLUMN IF NOT EXISTS category       VARCHAR(24),
  ADD COLUMN IF NOT EXISTS contact_person TEXT,
  ADD COLUMN IF NOT EXISTS address        TEXT;

COMMIT;
