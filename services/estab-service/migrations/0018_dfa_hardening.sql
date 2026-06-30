-- 0018: DFA hardening (gap analysis R3).
-- (a) Gapless DFA numbering — the DFA number is now allocated from
--     files.estab_doc_seq in the consumer transaction (series 'dfa:<TYPE>'),
--     replacing the old Math.random() generator. No schema change is needed for
--     the number itself (estab_doc_seq already exists), but we add a uniqueness
--     guarantee so a duplicate DFA number can never be persisted.
-- (b) Draft versioning — every revision of a draft (and the reviewer's return
--     comment) is retained in estab_dfa_version.
-- Additive + idempotent.

-- (a) DFA number must be unique per tenant (defence-in-depth for gapless seq).
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_dfa_no
  ON files.estab_dfa (tenant_id, dfa_no);

-- (b) DFA draft revision history.
CREATE TABLE IF NOT EXISTS files.estab_dfa_version (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  dfa_id      UUID NOT NULL,
  rev_no      INTEGER NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  comment     TEXT,                                   -- revision note / reviewer return reason
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID NOT NULL,
  CONSTRAINT uq_dfa_version UNIQUE (tenant_id, dfa_id, rev_no)
);
CREATE INDEX IF NOT EXISTS idx_dfa_version_lookup
  ON files.estab_dfa_version (tenant_id, dfa_id, rev_no);

GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_dfa_version TO estab_svc;
