-- GAP-CRM-CAMPAIGNS-01 / GAP-CRM-CAMPAIGNS-DETAIL-01: a campaign's display name.
--
-- crm.campaign_performance (migration 0031) identified a campaign only by its
-- campaign_id uuid, so the ROI list and the detail page could only show a raw
-- UUID. This adds an OPTIONAL display name carried on the same performance feed
-- (PUT /v1/crm/campaigns/:id/performance { campaignName }), and the ROI read
-- endpoints return the most recent non-null name per campaign as `name`.
--
-- Additive + idempotent: one nullable column, no backfill, no default churn. Rows
-- written before this migration (or by a feed that does not send a name) keep
-- NULL, which the web renders as a neutral "Unnamed campaign" label, never the id.
-- Rollback:
--   ALTER TABLE crm.campaign_performance DROP COLUMN IF EXISTS campaign_name;
-- Affected services: crm-service (dashboard module -- campaign ROI)
SET lock_timeout = '5s';

ALTER TABLE crm.campaign_performance
  ADD COLUMN IF NOT EXISTS campaign_name varchar(200);
