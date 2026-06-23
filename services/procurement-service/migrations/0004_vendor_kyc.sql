-- Add KYC columns to vendor table
ALTER TABLE vendor.procurement_vendors
  ADD COLUMN IF NOT EXISTS kyc_status     VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ;
