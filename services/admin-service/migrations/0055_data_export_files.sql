-- 0055_data_export_files.sql
-- OWNER DECISION #22 (TENANT-ADMIN-DATA-EXPORT-03): data exports are real files
-- in object storage (packages/storage) behind short-lived signed links. The
-- request row now records WHICH files were produced (one CSV per entity, or one
-- JSON for a full export), the entity a single-entity export targets, and why a
-- failed export failed (never a raw error).
-- Additive and idempotent; RLS on data_export.export_requests is unchanged.
SET lock_timeout = '5s';

ALTER TABLE data_export.export_requests
  ADD COLUMN IF NOT EXISTS entity_id      varchar(160),
  ADD COLUMN IF NOT EXISTS files          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS failure_reason varchar(64);

COMMENT ON COLUMN data_export.export_requests.files IS
  'Array of {entity, key, contentType, sizeBytes, rowCount} stored under packages/storage; links are signed per download, never persisted.';
