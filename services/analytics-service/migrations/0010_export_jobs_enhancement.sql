-- Migration: 0010_export_jobs_enhancement.sql
-- Purpose: Enhance export_jobs table with fileKey, expiresAt, fileSizeBytes, error columns
--          to support full export lifecycle with S3 storage and presigned URLs.
-- Rollback: ALTER TABLE analytics.export_jobs DROP COLUMN IF EXISTS file_key,
--           DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS file_size_bytes,
--           DROP COLUMN IF EXISTS error;
-- Affected services: analytics-service

SET lock_timeout = '5s';

-- Add file_key column for S3 object reference
ALTER TABLE analytics.export_jobs
  ADD COLUMN IF NOT EXISTS file_key TEXT;

-- Add expires_at column for presigned URL expiry tracking (24h TTL)
ALTER TABLE analytics.export_jobs
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Add file_size_bytes column (bigint to support up to 50MB cap measurement)
ALTER TABLE analytics.export_jobs
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

-- Add error column for failure reason logging
ALTER TABLE analytics.export_jobs
  ADD COLUMN IF NOT EXISTS error TEXT;

-- Change download_url from varchar(1024) to TEXT to support longer presigned URLs
-- (SigV4 presigned URLs can exceed 1024 chars)
ALTER TABLE analytics.export_jobs
  ALTER COLUMN download_url TYPE TEXT;

-- Update status column to support all lifecycle states
-- pending → processing → completed | failed
ALTER TABLE analytics.export_jobs
  ALTER COLUMN status SET DEFAULT 'pending';

-- Add CHECK constraint on status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_jobs_status_check'
  ) THEN
    ALTER TABLE analytics.export_jobs
      ADD CONSTRAINT export_jobs_status_check
      CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
END $$;

-- Add CHECK constraint on format values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_jobs_format_check'
  ) THEN
    ALTER TABLE analytics.export_jobs
      ADD CONSTRAINT export_jobs_format_check
      CHECK (format IN ('csv', 'json'));
  END IF;
END $$;

-- RLS is already enabled on the table from the parent analytics schema setup.
-- Ensure tenant isolation policy covers this table (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation' AND tablename = 'export_jobs' AND schemaname = 'analytics'
  ) THEN
    ALTER TABLE analytics.export_jobs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE analytics.export_jobs FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON analytics.export_jobs
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

COMMENT ON TABLE analytics.export_jobs IS 'Export jobs: CSV/JSON generation from query runs, uploaded to S3 with presigned URLs (24h TTL, 50MB max)';
