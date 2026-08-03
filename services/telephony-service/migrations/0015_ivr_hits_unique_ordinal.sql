-- Purpose: Guarantee IVR hit ordinals are unique per call.
-- Rollback: DROP INDEX IF EXISTS telephony.uq_ivr_hits_tenant_call_ordinal;
-- Affected services: telephony-service (IVR hit batch consumer)
--
-- Ordinals were assigned by the route from committed state and applied later by
-- the consumer, so two batches accepted before either applied were numbered from
-- the same base. Nothing in the schema rejected that: `idx_ivr_hits_call_ordinal`
-- is non-unique, and `chk_ivr_hits_ordinal` still passed because the second batch
-- simply restarted at 1 — which also let the 50-hit cap be exceeded. Ordinal
-- assignment now happens inside the consumer's write transaction; this index is
-- the backstop that makes a colliding batch roll back and retry instead of
-- corrupting the IVR path.
--
-- Operational note: this index fails to build if duplicate (tenant_id, call_id,
-- ordinal) rows already exist. Resolve any such rows before applying — they are
-- exactly the corruption this constraint prevents.

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ivr_hits_tenant_call_ordinal
  ON telephony.ivr_hits (tenant_id, call_id, ordinal);
