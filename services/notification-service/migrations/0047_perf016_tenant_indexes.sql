-- 0047_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. This tranche (5) covers procurement-service (11)
-- + grant-service (10) as its main pair, plus legal-service (9) and this
-- service -- notification-service (8) -- re-measured live on 2026-09-16 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster: 47 RLS tables / 8 missing,
-- matching the gap report row's own figure exactly.
--
-- This file is the notification-service half: 8 tables across the
-- _outbox/alerts/analytics/bulk/channels/digest/dnd/notification schemas,
-- with no index whose leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-4 --
-- checked directly against this service's live information_schema (as
-- notification_svc, not civitas_admin -- this database IS in
-- bootstrap-postgres.sh's EVIDENCE_SUITE_DBS admin-readonly grant list,
-- but the service role was used anyway for consistency with the other four
-- services in this tranche): alerts.alert_events, bulk.campaign_recipients,
-- digest.digest_buckets, dnd.held_notifications and
-- notification.conversation_messages carry a status column; the other 3
-- do not.
--
-- Index naming: idx_notification_<table>_tenant[_status]. Unlike
-- procurement/grant/legal in this same tranche, NONE of these 8 bare table
-- names already carry a notification_ prefix (alert_events, open_events,
-- campaign_recipients, channel_configs, digest_buckets, held_notifications,
-- conversation_messages, messages_legacy), so all 8 get notification_
-- prepended, matching tranche 3's "prepend when the table doesn't already
-- carry the service prefix" rule. Checked information_schema.tables for
-- bare-name collisions across schemas in civitas_notification: none found
-- among these 8 (the fleet-wide messages_legacy/messages/messages_default/
-- messages_y2026m* names are all within the same _outbox schema, not
-- across schemas). Checked pg_indexes for all 8 tables: no existing index
-- anywhere near these names (only *_pkey and feature-specific idx_*
-- names), so none of these CREATE INDEX CONCURRENTLY IF NOT EXISTS
-- statements silently skip a pre-existing, differently-purposed index.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-4's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_notification_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS alerts.idx_notification_alert_events_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS alerts.idx_notification_alert_events_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS analytics.idx_notification_open_events_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS bulk.idx_notification_campaign_recipients_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS bulk.idx_notification_campaign_recipients_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS channels.idx_notification_channel_configs_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS digest.idx_notification_digest_buckets_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS digest.idx_notification_digest_buckets_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS dnd.idx_notification_held_notifications_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS dnd.idx_notification_held_notifications_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS notification.idx_notification_conversation_messages_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS notification.idx_notification_conversation_messages_tenant_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_alert_events_tenant
  ON alerts.alert_events (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_alert_events_tenant_status
  ON alerts.alert_events (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_open_events_tenant
  ON analytics.open_events (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_campaign_recipients_tenant
  ON bulk.campaign_recipients (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_campaign_recipients_tenant_status
  ON bulk.campaign_recipients (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_channel_configs_tenant
  ON channels.channel_configs (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_digest_buckets_tenant
  ON digest.digest_buckets (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_digest_buckets_tenant_status
  ON digest.digest_buckets (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_held_notifications_tenant
  ON dnd.held_notifications (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_held_notifications_tenant_status
  ON dnd.held_notifications (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_conversation_messages_tenant
  ON notification.conversation_messages (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_conversation_messages_tenant_status
  ON notification.conversation_messages (tenant_id, status);
