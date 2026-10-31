-- UAT B10-F83 (review): first-class event time for audit events.
--
-- occurred_at is the hash-chain instant: it is assigned at append time,
-- strictly increasing per tenant, hashed, and it orders the chain
-- (findLatestForTenant / verifyChain), so it cannot be moved into the past for
-- a delayed or replayed delivery without breaking the chain. event_at is when
-- the audited action actually happened: the producer's outbox commit time,
-- carried in the envelope timestamp by the relay. It is also bound into the
-- chain hash (payload._eventAt). Readers should use event_at as the event time
-- and occurred_at as the recorded/sequence time.
--
-- Nullable, no backfill: rows are immutable (trg_events_immutable) and for
-- every pre-existing row event_at is effectively occurred_at (the API falls
-- back to it). Idempotent; ADD COLUMN on the partitioned parent reaches every
-- partition.
-- Rollback: DROP INDEX IF EXISTS events.idx_audit_events_tenant_event_at;
--           ALTER TABLE events.events DROP COLUMN IF EXISTS event_at;
ALTER TABLE events.events ADD COLUMN IF NOT EXISTS event_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_event_at ON events.events (tenant_id, event_at);
