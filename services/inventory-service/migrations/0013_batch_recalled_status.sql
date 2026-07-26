-- Migration: 0013_batch_recalled_status.sql
-- Purpose: Allow the "recalled" batch status so the SVC-055 recall write path
--          can persist a recalled lot. Additive + idempotent: widens the
--          existing chk_batches_status CHECK to include "recalled".
-- Rollback: re-add chk_batches_status without "recalled" (only if no rows use it).
-- Affected services: inventory-service
-- Requirements: 14.5, 14.6 (SVC-055)

SET lock_timeout = '5s';

ALTER TABLE inventory.batches DROP CONSTRAINT IF EXISTS chk_batches_status;
ALTER TABLE inventory.batches ADD CONSTRAINT chk_batches_status
  CHECK (status IN ('active', 'expired', 'depleted', 'quarantine', 'recalled'));
