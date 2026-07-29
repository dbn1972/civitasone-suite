-- 0092_candidate_resume_versions.sql
-- Candidate resume versioning (checklist R-RA-0087).
--   candidate.hrms_candidate_resumes — multiple resume versions per candidate,
--   exactly one active. The file itself lives in object storage; only its key
--   and metadata are recorded here. version_no is 1-based and monotonic per
--   candidate; a partial unique index guarantees at most ONE active version.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC.
--
-- Rollback: DROP TABLE IF EXISTS candidate.hrms_candidate_resumes;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_resumes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  candidate_id    uuid NOT NULL,
  version_no      integer NOT NULL,
  file_key        varchar(512) NOT NULL,
  file_name       varchar(255) NOT NULL,
  mime_type       varchar(128) NOT NULL,
  file_size_bytes bigint NOT NULL,
  fingerprint     varchar(128),
  label           varchar(120),
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  CONSTRAINT hrms_candidate_resumes_version_check CHECK (version_no >= 1),
  CONSTRAINT hrms_candidate_resumes_size_check CHECK (file_size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS hrms_candidate_resumes_cand_idx
  ON candidate.hrms_candidate_resumes (tenant_id, candidate_id);

-- version_no is stable per candidate — computed as max+1 inside a txn.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_candidate_resumes_version_uq
  ON candidate.hrms_candidate_resumes (tenant_id, candidate_id, version_no);

-- At most ONE active resume per candidate (DB-level guarantee, not just app).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_candidate_resumes_active_uq
  ON candidate.hrms_candidate_resumes (tenant_id, candidate_id) WHERE is_active;

ALTER TABLE candidate.hrms_candidate_resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate.hrms_candidate_resumes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_candidate_resumes_tenant_isolation ON candidate.hrms_candidate_resumes;
CREATE POLICY hrms_candidate_resumes_tenant_isolation ON candidate.hrms_candidate_resumes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate.hrms_candidate_resumes TO hrms_svc;
