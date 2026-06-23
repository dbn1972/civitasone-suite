-- eOffice world-class: part files, DAK barcode, DSC on notes
ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS parent_file_id uuid;

ALTER TABLE files.estab_inward
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS source_section varchar(32);

ALTER TABLE files.estab_notings
  ADD COLUMN IF NOT EXISTS signature_ref text,
  ADD COLUMN IF NOT EXISTS dsc_hash text;

CREATE INDEX IF NOT EXISTS idx_estab_files_parent ON files.estab_files(parent_file_id);
CREATE INDEX IF NOT EXISTS idx_estab_files_due_by ON files.estab_files(due_by);
