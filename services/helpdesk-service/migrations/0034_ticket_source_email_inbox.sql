-- Purpose: widen helpdesk.tickets.source CHECK constraint to allow 'email/inbox'.
--   Closes an orphan loop: notification-service's inbox "convert to ticket"
--   action (notification.inbox.convert_to_ticket) opens a linked ticket here
--   via the same idempotent (tenant, source, source_ref) path used for
--   telephony/crm/catalogue/knowledge_assistant provenance (migrations
--   0010/0014/0015), but tickets_source_check did not yet allow the new
--   source tag — the insert would fail the CHECK constraint.
-- Rollback: ALTER TABLE helpdesk.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
--           ALTER TABLE helpdesk.tickets ADD CONSTRAINT tickets_source_check
--             CHECK (source IS NULL OR source::text = ANY (ARRAY['telephony','crm','catalogue','knowledge_assistant']::text[]));
-- Affected services: helpdesk-service (write path: modules/tickets/consumer.js — CONSUMES.notificationInboxConvertToTicket)

SET lock_timeout = '5s';

ALTER TABLE helpdesk.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE helpdesk.tickets ADD CONSTRAINT tickets_source_check
  CHECK (source IS NULL OR source::text = ANY (ARRAY['telephony','crm','catalogue','knowledge_assistant','email/inbox']::text[]));
