-- V4-G-07: persist the original send content (merge variables, eventType,
-- marketing category / campaignId, inline subject + body) on the delivery row
-- when a retry is scheduled, so the durable retry sweeper can republish the
-- same message instead of a content-less command. Nullable and additive:
-- existing rows and rollback (drop column) are safe. No RLS change - the
-- table keeps its existing tenant policy.
ALTER TABLE deliveries.deliveries ADD COLUMN IF NOT EXISTS retry_payload jsonb;

-- DOWN: ALTER TABLE deliveries.deliveries DROP COLUMN IF EXISTS retry_payload;
