-- 0020: CSMOP file-type taxonomy (gap analysis R2).
-- Adds the file-type classification, volume number, and symmetric linked-file
-- references to estab_files so part files, volumes (Vol I/II/…), linked files,
-- standing guard files and ephemeral files are first-class. Additive + idempotent.

ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS file_type      TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS volume_no      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS part_no        INTEGER,
  ADD COLUMN IF NOT EXISTS linked_file_ids UUID[] NOT NULL DEFAULT '{}';

-- Guard the taxonomy values (drop-then-add keeps the forward migration idempotent).
ALTER TABLE files.estab_files DROP CONSTRAINT IF EXISTS chk_estab_files_file_type;
ALTER TABLE files.estab_files
  ADD CONSTRAINT chk_estab_files_file_type CHECK (file_type IN
    ('main','part','volume','linked','standing_guard','ephemeral'));

CREATE INDEX IF NOT EXISTS idx_estab_files_type ON files.estab_files (tenant_id, file_type);
CREATE INDEX IF NOT EXISTS idx_estab_files_parent ON files.estab_files (tenant_id, parent_file_id);
