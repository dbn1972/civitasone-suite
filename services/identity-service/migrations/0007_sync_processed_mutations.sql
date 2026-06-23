-- SYN-1b (03-T2): idempotent client mutations.
--
-- The push handler previously validated and echoed clientMutationId but never
-- persisted it, so a replayed batch (the client retries failed/queued entries)
-- re-appended changelog rows and produced duplicate server state. This table
-- records the outcome of every processed mutation, keyed uniquely by
-- (tenant, device, client_mutation_id), so a replay is detected and the prior
-- result is returned instead of re-applying.

CREATE TABLE IF NOT EXISTS sync.processed_mutations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  device_id          UUID NOT NULL,
  client_mutation_id UUID NOT NULL,
  mailbox            VARCHAR(32) NOT NULL,
  entity_id          UUID NOT NULL,
  status             VARCHAR(16) NOT NULL,          -- applied | conflict | failed
  result_etag        TEXT,
  result_seq         BIGINT,
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, device_id, client_mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_mutations_lookup
  ON sync.processed_mutations (tenant_id, device_id, client_mutation_id);

-- SYN-1c (03-T3): conflict detection needs the latest changelog row per entity
-- quickly. Index the changelog by (tenant, mailbox, entity, seq desc).
CREATE INDEX IF NOT EXISTS idx_changelog_entity_latest
  ON sync.entity_changelog (tenant_id, mailbox, entity_id, seq DESC);
