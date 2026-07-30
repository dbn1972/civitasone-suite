-- 0097_interview_recordings.sql
-- Interview recording / transcript with consent + retention (checklist R-RA-0152).
--   recruitment.hrms_interview_recordings — only the object-store key is stored
--   (bytes live behind the storage seam). Consent is mandatory; retention_until
--   drives the purge job; erasure is a soft-delete (status='deleted') + an
--   object-store purge (stubbed until the adapter is wired).
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC (recruitment schema).
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_interview_recordings;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recruitment.hrms_interview_recordings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  interview_id    uuid NOT NULL,
  application_id  uuid NOT NULL,
  kind            varchar(12) NOT NULL,
  storage_key     varchar(512) NOT NULL,
  consent_given   boolean NOT NULL DEFAULT false,
  consent_reference varchar(200),
  consent_by      uuid,
  consent_at      timestamptz,
  retention_until date NOT NULL,
  status          varchar(10) NOT NULL DEFAULT 'active',
  deleted_at      timestamptz,
  deleted_by      uuid,
  object_purged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_interview_recordings_kind_check
    CHECK (kind IN ('recording','transcript')),
  CONSTRAINT hrms_interview_recordings_status_check
    CHECK (status IN ('active','deleted')),
  -- Defense in depth: an artefact can never be stored without consent.
  CONSTRAINT hrms_interview_recordings_consent_check
    CHECK (consent_given = true)
);

CREATE INDEX IF NOT EXISTS hrms_interview_recordings_iv_idx
  ON recruitment.hrms_interview_recordings (tenant_id, interview_id, status);
-- Supports the retention purge scan (active artefacts past their deadline).
CREATE INDEX IF NOT EXISTS hrms_interview_recordings_retention_idx
  ON recruitment.hrms_interview_recordings (tenant_id, status, retention_until);
-- One active record per object key so erasing one can never purge another's bytes.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_interview_recordings_key_uq
  ON recruitment.hrms_interview_recordings (tenant_id, storage_key) WHERE status = 'active';

ALTER TABLE recruitment.hrms_interview_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_interview_recordings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_interview_recordings_tenant_isolation ON recruitment.hrms_interview_recordings;
CREATE POLICY hrms_interview_recordings_tenant_isolation ON recruitment.hrms_interview_recordings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_interview_recordings TO hrms_svc;
