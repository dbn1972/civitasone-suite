-- 0013: CSMOP / Record Retention Schedule / Public Records Act — records management
-- Adds per-file record categorisation + retention metadata and a weed-out
-- (destruction) approval workflow. Additive + idempotent (safe to re-run).
--
-- Record categories → retention:
--   A = permanent (retention_years NULL; never weeded)
--   B = 10 years, C = 5 years, D = 3 years, E = 1 year

-- ─── Per-file record metadata ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files.estab_file_record (
  tenant_id       UUID NOT NULL,
  file_id         UUID NOT NULL,
  record_category VARCHAR(2) NOT NULL,
  retention_years INTEGER,
  review_due_date DATE,
  disposal_action TEXT,
  disposed_at     TIMESTAMPTZ,
  disposed_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_at      TIMESTAMPTZ,
  updated_by      UUID,
  PRIMARY KEY (tenant_id, file_id),
  CONSTRAINT chk_estab_file_record_category CHECK (record_category IN ('A','B','C','D','E'))
);

-- ─── Weed-out (destruction) approval workflow ──────────────────────────────
CREATE TABLE IF NOT EXISTS files.estab_weedout (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  file_id              UUID NOT NULL,
  status               VARCHAR(16) NOT NULL DEFAULT 'proposed',
  proposed_by          UUID NOT NULL,
  proposed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by          UUID,
  reviewed_at          TIMESTAMPTZ,
  destruction_cert_ref TEXT,
  destroyed_at         TIMESTAMPTZ,
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version              INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_estab_weedout_status CHECK (status IN ('proposed','approved','rejected','destroyed'))
);

CREATE INDEX IF NOT EXISTS idx_estab_weedout_file   ON files.estab_weedout (tenant_id, file_id);
CREATE INDEX IF NOT EXISTS idx_estab_weedout_status ON files.estab_weedout (tenant_id, status);
