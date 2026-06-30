-- 0019: Organisation hierarchy (gap analysis R1).
-- CSMOP Ch. 2 — a first-class Ministry → Department → Wing → Division → Section
-- → Desk tree so file marking lists and the channel of submission are derived
-- from the hierarchy rather than from free-text division/section strings.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS files.estab_org_unit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,                       -- ministry|department|wing|division|section|desk
  parent_id        UUID REFERENCES files.estab_org_unit(id), -- self-referential tree (NULL = root)
  head_operator_id UUID,                                -- desk/operator heading this unit (estab_file_operator)
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID NOT NULL,
  updated_by       UUID NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_org_unit_type CHECK (type IN
    ('ministry','department','wing','division','section','desk'))
);

-- One organisation code per tenant (immutable identifier for marking/routing).
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_unit_code
  ON files.estab_org_unit (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_org_unit_parent
  ON files.estab_org_unit (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_org_unit_type
  ON files.estab_org_unit (tenant_id, type, active);

-- Optional links from operators/files to an org unit (hierarchy-derived routing).
ALTER TABLE files.estab_file_operator
  ADD COLUMN IF NOT EXISTS org_unit_id UUID;
ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS org_unit_id UUID;

-- The migration runs as civitas_admin; the service connects as estab_svc.
GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_org_unit TO estab_svc;
