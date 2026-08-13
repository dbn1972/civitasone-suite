-- Migration 0041: extend chk_deliveries_status to allow 'read' status
-- Context: inbox mark-as-read feature sets status='read' to indicate user
-- has acknowledged the notification in their inbox.
SET lock_timeout = '5s';

ALTER TABLE deliveries.deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_status;
ALTER TABLE deliveries.deliveries
  ADD CONSTRAINT chk_deliveries_status
  CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'skipped', 'read'));
