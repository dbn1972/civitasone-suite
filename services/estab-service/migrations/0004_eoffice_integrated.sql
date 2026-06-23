-- Integrated eOffice: yellow/green notes, DAK linkage, attachments, SLA
ALTER TABLE files.estab_notings
  ADD COLUMN IF NOT EXISTS note_type varchar(16) NOT NULL DEFAULT 'yellow',
  ADD COLUMN IF NOT EXISTS note_status varchar(16) NOT NULL DEFAULT 'draft';

ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS inward_id uuid,
  ADD COLUMN IF NOT EXISTS dak_no text,
  ADD COLUMN IF NOT EXISTS due_by timestamptz;

ALTER TABLE files.estab_inward
  ADD COLUMN IF NOT EXISTS file_id uuid;

CREATE TABLE IF NOT EXISTS files.estab_file_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  file_id uuid NOT NULL,
  file_name text NOT NULL,
  file_type varchar(64) NOT NULL DEFAULT 'application/pdf',
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_ref text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_estab_inward_tenant ON files.estab_inward(tenant_id);
CREATE INDEX IF NOT EXISTS idx_estab_dispatch_tenant ON files.estab_dispatch(tenant_id);
CREATE INDEX IF NOT EXISTS idx_estab_attachments_file ON files.estab_file_attachments(file_id);
