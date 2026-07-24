-- 0015 — LOOP 1: escalate-to-ticket (knowledge-service assistant → helpdesk).
-- The knowledge-service assistant escalates unanswered questions by emitting
-- helpdesk.ticket.create tagged source='knowledge_assistant'. The helpdesk
-- create consumer opens a linked ticket through the same idempotent
-- (tenant, source, source_ref) path used for telephony/crm/catalogue provenance.
-- Additive: widen the existing CHECK to include the new provenance value.
ALTER TABLE helpdesk.tickets DROP CONSTRAINT IF EXISTS tickets_source_check;
ALTER TABLE helpdesk.tickets ADD CONSTRAINT tickets_source_check
  CHECK (source IS NULL OR source::text = ANY (ARRAY['telephony','crm','catalogue','knowledge_assistant']::text[]));
