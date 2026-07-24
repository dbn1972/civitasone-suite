-- Purpose: Add content_type and approval workflow fields to templates schema
-- Rollback: ALTER TABLE templates.templates DROP COLUMN IF EXISTS content_type, DROP COLUMN IF EXISTS submitted_by, DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS rejection_reason;
-- Affected services: notification-service (approval module, MJML rendering, delivery pipeline)
SET lock_timeout = '5s';

ALTER TABLE templates.templates
  ADD COLUMN IF NOT EXISTS content_type varchar(16) NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by  uuid,
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Update status check constraint to include new workflow states
-- (drop old constraint first if it exists, then add expanded)
ALTER TABLE templates.templates
  DROP CONSTRAINT IF EXISTS chk_template_status;
ALTER TABLE templates.templates
  ADD CONSTRAINT chk_template_status
  CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'active', 'archived'));
