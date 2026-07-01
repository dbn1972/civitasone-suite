-- 0026: NIC eOffice parity features (gap analysis R8).
-- (a) DFA template library (standard OM/letter/sanction/notification templates).
-- (b) VIP / Parliament-question reference fields on estab_files.
-- (c) Auto-link outward correspondence handled in the DFA dispatch consumer (no
--     separate migration needed — uses existing estab_correspondence table).
-- Additive + idempotent.

-- (a) DFA template library.
CREATE TABLE IF NOT EXISTS files.estab_dfa_template (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  communication_type  TEXT NOT NULL DEFAULT 'letter',
  body                TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          UUID NOT NULL,
  version             INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dfa_template_code
  ON files.estab_dfa_template (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_dfa_template_active
  ON files.estab_dfa_template (tenant_id, is_active);

-- (b) VIP / Parliament-question reference fields.
ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS vip_reference   TEXT,
  ADD COLUMN IF NOT EXISTS parliament_qno  TEXT,
  ADD COLUMN IF NOT EXISTS is_vip          BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_estab_files_vip
  ON files.estab_files (tenant_id, is_vip) WHERE is_vip = TRUE;

GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_dfa_template TO estab_svc;
