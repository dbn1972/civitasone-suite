CREATE TABLE IF NOT EXISTS files.estab_file_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  file_id UUID NOT NULL,
  from_officer_id UUID,
  to_officer_id UUID NOT NULL,
  action VARCHAR(30) DEFAULT 'forward',
  remarks TEXT,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_movements_file ON files.estab_file_movements(file_id, tenant_id, moved_at);
