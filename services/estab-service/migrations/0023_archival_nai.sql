-- 0023: Archival workflow + NAI transfer (gap analysis R5).
-- Distinct from closure: an 'archive' verb sets archival metadata; Cat-A
-- (permanent) records become NAI-eligible after 25 years. Additive + idempotent.

CREATE TABLE IF NOT EXISTS files.estab_archival (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  file_id          UUID NOT NULL,
  archived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by      UUID NOT NULL,
  nai_eligible_at  TIMESTAMPTZ,                        -- Cat-A: closed + 25 years
  nai_transferred_at TIMESTAMPTZ,
  nai_reference    TEXT,
  register_no      TEXT,
  status           TEXT NOT NULL DEFAULT 'archived',    -- archived|nai_due|nai_transferred
  remarks          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_archival_status CHECK (status IN ('archived','nai_due','nai_transferred'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_archival_file ON files.estab_archival (tenant_id, file_id);
CREATE INDEX IF NOT EXISTS idx_archival_nai_due ON files.estab_archival (tenant_id, status) WHERE status = 'nai_due';

GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_archival TO estab_svc;
