ALTER TABLE install.stages
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text;

UPDATE install.stages SET status = 'pending' WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_install_stages_status ON install.stages(tenant_id, status, step_number);
