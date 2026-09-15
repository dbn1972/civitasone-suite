-- PERF-008: schema_version column for _outbox.messages.
-- Additive, backward compatible: DEFAULT applies to existing unpublished
-- rows too, so relayOnce (packages/outbox/src/index.ts) can always read
-- row.schemaVersion instead of the old hardcoded "1.0" literal. Idempotent.
ALTER TABLE _outbox.messages ADD COLUMN IF NOT EXISTS schema_version varchar(16) NOT NULL DEFAULT '1.0';
