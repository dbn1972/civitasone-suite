-- citizen-service migration 0050 - D2 follow-up: map a CPIO directory entry to its platform user.
--
-- rti.cpio_directory.user_id (nullable) is the identity-service user id of the CPIO. It lets the RTI
-- appeal-decision separation-of-duties check refuse the RTI's ASSIGNED CPIO (not only whoever uploaded
-- the response). Nullable: existing entries stay NULL until an admin sets it, and a NULL never blocks.
--
-- Additive + idempotent. DDL only (no DML), so no NO FORCE / FORCE wrap needed.

ALTER TABLE rti.cpio_directory
  ADD COLUMN IF NOT EXISTS user_id uuid;
