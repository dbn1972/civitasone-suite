-- 0022: Record-room management (gap analysis R4).
-- Physical location fields on the per-file record row and an issue/receipt
-- requisition register for custody tracking. Additive + idempotent.

-- (a) Location fields on estab_file_record.
ALTER TABLE files.estab_file_record
  ADD COLUMN IF NOT EXISTS room_status    TEXT NOT NULL DEFAULT 'in_section',
  ADD COLUMN IF NOT EXISTS record_room_id TEXT,
  ADD COLUMN IF NOT EXISTS rack           TEXT,
  ADD COLUMN IF NOT EXISTS shelf          TEXT,
  ADD COLUMN IF NOT EXISTS bundle_no      TEXT,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

ALTER TABLE files.estab_file_record DROP CONSTRAINT IF EXISTS chk_room_status;
ALTER TABLE files.estab_file_record
  ADD CONSTRAINT chk_room_status CHECK (room_status IN ('in_section','in_record_room','issued'));

-- (b) Requisition register.
CREATE TABLE IF NOT EXISTS files.estab_record_requisition (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  file_id      UUID NOT NULL,
  requested_by UUID NOT NULL,
  purpose      TEXT,
  status       TEXT NOT NULL DEFAULT 'issued',  -- issued|returned
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_back     DATE,
  returned_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NOT NULL,
  version      INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_requisition_status CHECK (status IN ('issued','returned'))
);
CREATE INDEX IF NOT EXISTS idx_estab_requisition_file
  ON files.estab_record_requisition (tenant_id, file_id);
CREATE INDEX IF NOT EXISTS idx_estab_requisition_status
  ON files.estab_record_requisition (tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON files.estab_record_requisition TO estab_svc;
