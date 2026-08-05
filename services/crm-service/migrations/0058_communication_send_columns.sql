-- Purpose: CO-001 — add status, template_id, scheduled_at and delivery_id to
--   crm.communications so the new send/bulk-send routes can track outbound
--   message lifecycle from pending → sent → delivered/failed/consent_revoked.
-- Rollback:
--   ALTER TABLE crm.communications DROP COLUMN IF EXISTS status;
--   ALTER TABLE crm.communications DROP COLUMN IF EXISTS template_id;
--   ALTER TABLE crm.communications DROP COLUMN IF EXISTS scheduled_at;
--   ALTER TABLE crm.communications DROP COLUMN IF EXISTS delivery_id;
-- Affected services: crm-service (communications module)
-- Sequencing: additive — nullable columns with defaults, no backfill needed.

SET lock_timeout = '5s';

ALTER TABLE crm.communications
  ADD COLUMN IF NOT EXISTS status varchar(24) DEFAULT 'logged';

ALTER TABLE crm.communications
  ADD COLUMN IF NOT EXISTS template_id uuid;

ALTER TABLE crm.communications
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

ALTER TABLE crm.communications
  ADD COLUMN IF NOT EXISTS delivery_id uuid;
