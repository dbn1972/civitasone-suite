-- citizen-service migration 0023 — FN-23 Applicant Identity Types.
-- Additive only. Idempotent (IF NOT EXISTS) for migrate-all.mjs.

SET lock_timeout = '5s';

-- ── catalogue.service_definitions — designer configuration ──────────────────
ALTER TABLE catalogue.service_definitions
  ADD COLUMN IF NOT EXISTS allowed_applicant_types jsonb NOT NULL DEFAULT '["citizen"]'::jsonb,
  ADD COLUMN IF NOT EXISTS applicant_type_reject_message text,
  ADD COLUMN IF NOT EXISTS profile_attribute_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── application runtime — persisted applicant type on draft + submission ────
ALTER TABLE application.citizen_applications
  ADD COLUMN IF NOT EXISTS applicant_type varchar(16);

ALTER TABLE application.application_drafts
  ADD COLUMN IF NOT EXISTS applicant_type varchar(16);

ALTER TABLE application.citizen_applications
  DROP CONSTRAINT IF EXISTS chk_app_applicant_type;
ALTER TABLE application.citizen_applications
  ADD CONSTRAINT chk_app_applicant_type
  CHECK (
    applicant_type IS NULL
    OR applicant_type IN ('citizen', 'company', 'institution', 'anonymous')
  );

ALTER TABLE application.application_drafts
  DROP CONSTRAINT IF EXISTS chk_draft_applicant_type;
ALTER TABLE application.application_drafts
  ADD CONSTRAINT chk_draft_applicant_type
  CHECK (
    applicant_type IS NULL
    OR applicant_type IN ('citizen', 'company', 'institution', 'anonymous')
  );
