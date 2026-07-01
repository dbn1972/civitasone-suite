-- 0024: Structured referencing (gap analysis R7, CSMOP "Referencing").
-- Typed, stable reference objects: a noting can cite a PUC, FR/SR/GFR rule,
-- precedent file, financial concurrence, legal opinion, annexure, or cross-file
-- reference. These remain stable (by id) independent of note edits.

CREATE TABLE IF NOT EXISTS files.estab_reference (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  file_id      UUID NOT NULL,
  note_id      UUID,                                   -- nullable: may be file-level
  ref_type     TEXT NOT NULL,                          -- puc|rule|precedent_file|concurrence|legal_opinion|annexure|cross_file
  ref_value    TEXT NOT NULL,                          -- the rule/provision/reference text
  label        TEXT,                                   -- human-readable label
  target_file_id UUID,                                -- for cross-file/precedent refs
  page_from    INT,
  page_to      INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NOT NULL,
  CONSTRAINT chk_ref_type CHECK (ref_type IN
    ('puc','rule','precedent_file','concurrence','legal_opinion','annexure','cross_file'))
);

CREATE INDEX IF NOT EXISTS idx_estab_reference_file ON files.estab_reference (tenant_id, file_id);
CREATE INDEX IF NOT EXISTS idx_estab_reference_note ON files.estab_reference (tenant_id, note_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_reference TO estab_svc;
