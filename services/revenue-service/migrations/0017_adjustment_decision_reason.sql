-- revenue-service migration 0017 - adjustment decision reason
-- Applied AFTER 0016_bbps_request_status.sql
-- Rollback:
--   ALTER TABLE collection.adjustments DROP COLUMN IF EXISTS decision_reason;
--
-- The checker approve/reject reason (PATCH /adjustments/:id/decide body.reason)
-- was accepted by the API but neither persisted nor audited, so a rejection
-- reason was lost. Additive and nullable; existing grants on the table cover it.

SET lock_timeout = '5s';

ALTER TABLE collection.adjustments
  ADD COLUMN IF NOT EXISTS decision_reason text;
