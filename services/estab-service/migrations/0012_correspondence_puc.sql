-- 0012: CSMOP correspondence (the "yellow side") + PUC tagging
-- Applied with civitas_admin on civitas_estab.
-- Additive + idempotent (CREATE TABLE/INDEX IF NOT EXISTS), safe to re-run.
--
-- estab_correspondence: per-file running register of incoming/outgoing letters
-- with STABLE, append-only CSMOP page numbering (page_from/page_to). Existing
-- page numbers are never renumbered when new correspondence is added.
--
-- estab_file_puc: Paper Under Consideration tags. Multiple PUCs may be active
-- on a file simultaneously (multiple active rows); unmark sets active = false.

CREATE TABLE IF NOT EXISTS files.estab_correspondence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  file_id         UUID NOT NULL,
  corr_no         TEXT NOT NULL,                       -- running "C-<n>" per file
  direction       VARCHAR(16) NOT NULL,                -- 'incoming' | 'outgoing'
  letter_ref      TEXT,
  letter_date     DATE,
  party           TEXT NOT NULL,                       -- sender (incoming) / addressee (outgoing)
  subject         TEXT NOT NULL,
  page_from       INTEGER NOT NULL,
  page_to         INTEGER NOT NULL,
  storage_ref     TEXT,
  is_office_copy  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_estab_correspondence_file
  ON files.estab_correspondence (tenant_id, file_id);

CREATE TABLE IF NOT EXISTS files.estab_file_puc (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  file_id           UUID NOT NULL,
  correspondence_id UUID NOT NULL,
  marked_by         UUID NOT NULL,
  marked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_estab_file_puc_file
  ON files.estab_file_puc (tenant_id, file_id);

-- Partial index over the active PUCs for a file (the common "what is under
-- consideration right now" lookup).
CREATE INDEX IF NOT EXISTS idx_estab_file_puc_active
  ON files.estab_file_puc (tenant_id, file_id)
  WHERE active;

-- The migration runs as civitas_admin; the service connects as estab_svc, so
-- hand it the same DML grants the rest of the files schema already enjoys.
GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_correspondence TO estab_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_file_puc        TO estab_svc;
