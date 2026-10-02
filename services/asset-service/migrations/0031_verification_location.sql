-- Migration: 0031_verification_location.sql
-- GAP-ASSETS-VERIFICATION-01: a physical-verification session records WHICH
-- site was verified. The web used to post a hard-coded "HQ Block" that the
-- route silently dropped (no column existed), so every session was
-- site-less. Nullable: existing sessions have no recorded location.
-- Rollback: ALTER TABLE lifecycle.physical_verifications DROP COLUMN IF EXISTS location;

SET lock_timeout = '5s';

ALTER TABLE lifecycle.physical_verifications
  ADD COLUMN IF NOT EXISTS location text;
