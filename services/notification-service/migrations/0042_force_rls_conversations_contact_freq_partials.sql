-- Deep-verify audit (notification-service): re-checking today's PR #763
-- (RLS-GUC fix in stream/repo.ts) for "the same pattern elsewhere in this
-- service" turned up a broader, longstanding gap than first scoped.
--
-- 0036_conversations.sql and 0038_contact_frequency.sql each ran `ENABLE ROW
-- LEVEL SECURITY` but omitted the `FORCE ROW LEVEL SECURITY` companion that
-- most sibling migrations in this service pair it with (0033 complaint_events,
-- 0035 bulk.campaign_responses, 0036_dlt_templates, 0037 channel_quotas, 0039
-- inbound_review_queue, 0040 message_attachments all ENABLE+FORCE together).
-- A full scan of every ENABLE ROW LEVEL SECURITY statement in this service's
-- migrations against every FORCE ROW LEVEL SECURITY statement (any file, not
-- just the same one) found the gap is much wider than those two files: 14
-- tables total, spanning 10 different migrations from 0013 through 0038,
-- have RLS enabled with a tenant_isolation policy but were never forced.
-- Confirmed against live pg_class on civitas_notification for all 14 (not
-- just asserted from the SQL text):
--
--   scheduling.scheduled_notifications  (0013_scheduling_schema.sql)
--   digest.digest_rules                 (0014_digest_schema.sql)
--   digest.digest_buckets               (0014_digest_schema.sql)
--   webhook.endpoints                   (0015_webhook_schema.sql)
--   analytics.open_events               (0016_analytics_schema.sql)
--   analytics.click_events              (0016_analytics_schema.sql)
--   analytics.delivery_metrics          (0016_analytics_schema.sql)
--   dnd.dnd_windows                     (0017_dnd_schema.sql)
--   dnd.held_notifications              (0017_dnd_schema.sql)
--   segments.recipient_segments         (0019_segments_schema.sql)
--   templates.partials                  (0021_template_partials.sql)
--   i18n.locale_variants                (0018_i18n_schema.sql)
--   notification.conversations          (0036_conversations.sql)
--   notification.conversation_messages  (0036_conversations.sql)
--   notification.contact_frequency      (0038_contact_frequency.sql)
--
-- (i18n.locale_variants was missed by the first pass of this audit's own
-- migration-text grep -- a case where the grep's character class didn't
-- match this particular line even though the text is a plain ENABLE ROW
-- LEVEL SECURITY statement like all the others. Found instead by re-querying
-- pg_class directly after applying this migration and seeing one table still
-- unforced -- the actual, authoritative check this migration was verified
-- against throughout, not the grep. Included here for completeness.)
--
-- Impact: notification-service connects to Postgres as `notification_svc`,
-- which OWNS this database and is not itself BYPASSRLS/superuser (confirmed
-- via pg_roles). Without FORCE, Postgres skips RLS entirely for the owning
-- role, so all 14 tables above currently have NO database-level
-- tenant-isolation backstop -- they rely solely on whatever app-layer
-- `WHERE tenant_id = ...` predicates the route/consumer code happens to
-- include. This service has no scanner/BYPASSRLS role of its own (unlike
-- contract/court/visitor/works, which deliberately need one for a relay
-- role), so there is no legitimate reason for any of these 14 to be
-- unforced -- forcing all of them brings the service in line with its own
-- established convention with no known functional cost.
--
-- No live cross-tenant leak was reproduced on any of these tables during
-- this audit (spot-checked conversations/contact_frequency's app-layer
-- filters directly; did not exhaustively re-derive every one of the other
-- 10 tables' query sites, so treat those 10 as "confirmed structurally
-- gapped, not individually exploit-confirmed"). This migration closes the
-- gap outright rather than leaving it as a latent, easy-to-forget
-- inconsistency the next schema change could compound.
--
-- Rollback: re-run each statement below with FORCE -> NO FORCE.

SET lock_timeout = '5s';

ALTER TABLE notification.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.conversation_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.contact_frequency FORCE ROW LEVEL SECURITY;
ALTER TABLE templates.partials FORCE ROW LEVEL SECURITY;
ALTER TABLE scheduling.scheduled_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE digest.digest_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE digest.digest_buckets FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook.endpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.open_events FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.click_events FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.delivery_metrics FORCE ROW LEVEL SECURITY;
ALTER TABLE dnd.dnd_windows FORCE ROW LEVEL SECURITY;
ALTER TABLE dnd.held_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE segments.recipient_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE i18n.locale_variants FORCE ROW LEVEL SECURITY;
