-- Purpose: Add 'rejected' to instances_status_check constraint to support R13 unknown-definition rejection
-- Rollback: ALTER TABLE workflow.instances DROP CONSTRAINT IF EXISTS instances_status_check;
--           Then re-add the original constraint without 'rejected' (only safe if no rejected rows exist).
-- Affected services: workflow-service

SET lock_timeout = '5s';

-- Drop the old constraint and re-add with the expanded set
ALTER TABLE workflow.instances DROP CONSTRAINT IF EXISTS instances_status_check;

DO $$ BEGIN
  ALTER TABLE workflow.instances
    ADD CONSTRAINT instances_status_check
    CHECK (status IN ('active', 'completed', 'suspended', 'cancelled', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE workflow.instances VALIDATE CONSTRAINT instances_status_check;
