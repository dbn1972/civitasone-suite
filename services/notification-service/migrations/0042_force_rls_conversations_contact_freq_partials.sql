-- Deep-verify audit (notification-service): 0036_conversations.sql and
-- 0038_contact_frequency.sql each ran `ENABLE ROW LEVEL SECURITY` but omitted
-- the `FORCE ROW LEVEL SECURITY` companion statement that every sibling
-- migration in this service pairs it with (0033 complaint_events, 0035
-- bulk.campaign_responses, 0036_dlt_templates, 0037 channel_quotas, 0039
-- inbound_review_queue, 0040 message_attachments all ENABLE+FORCE together).
-- Same gap found on templates.partials's migration.
--
-- Confirmed live via pg_class: conversations, conversation_messages,
-- contact_frequency, and templates.partials are the only 4 tables in this
-- service's schema with relrowsecurity=t but relforcerowsecurity=f, while
-- every sibling table (including conversation_handoffs / handoff_audit in
-- the very same G5 conversations feature) has both set.
--
-- Impact: notification-service connects to Postgres as `notification_svc`,
-- which OWNS this database. Without FORCE, RLS policies are skipped for the
-- owning role entirely (Postgres semantics), so these 4 tables currently
-- have NO database-level tenant-isolation backstop — they rely solely on the
-- application-layer `WHERE tenant_id = ...` predicates already present in
-- their repo/consumer code. No live cross-tenant read was reproduced (the
-- app-layer filters are correct everywhere checked), but this is a real
-- defense-in-depth gap versus the rest of the fleet's convention, and worth
-- closing outright rather than leaving as a latent inconsistency.
--
-- Rollback:
--   ALTER TABLE notification.conversations NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE notification.conversation_messages NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE notification.contact_frequency NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE templates.partials NO FORCE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

ALTER TABLE notification.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.conversation_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.contact_frequency FORCE ROW LEVEL SECURITY;
ALTER TABLE templates.partials FORCE ROW LEVEL SECURITY;
