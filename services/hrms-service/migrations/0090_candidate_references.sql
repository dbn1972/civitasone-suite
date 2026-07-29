-- 0090_candidate_references.sql
-- Candidate identity & profile — reservation-attribute detail (R-RA-0082) and
-- references + prior-relationship declarations (R-RA-0083).
-- Extends candidate.hrms_candidates; new candidate.hrms_candidate_references.
-- FORCE RLS. Additive + idempotent.
--
-- Rollback: DROP TABLE candidate.hrms_candidate_references;
--           ALTER TABLE candidate.hrms_candidates DROP COLUMN disability_type, ...;

ALTER TABLE candidate.hrms_candidates
  ADD COLUMN IF NOT EXISTS disability_type          varchar(24),
  ADD COLUMN IF NOT EXISTS disability_percentage    integer,
  ADD COLUMN IF NOT EXISTS freedom_fighter_dependent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservation_docs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS relationship_declaration jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE candidate.hrms_candidates
  DROP CONSTRAINT IF EXISTS hrms_candidates_disability_pct_check;
ALTER TABLE candidate.hrms_candidates
  ADD CONSTRAINT hrms_candidates_disability_pct_check
  CHECK (disability_percentage IS NULL OR (disability_percentage >= 1 AND disability_percentage <= 100));

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_references (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  candidate_id  uuid NOT NULL,
  ref_name      varchar(200) NOT NULL,
  relationship  varchar(120) NOT NULL,
  organisation  varchar(200),
  designation   varchar(120),
  email         varchar(200),
  phone         varchar(20),
  years_known   integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hrms_candidate_references_cand_idx
  ON candidate.hrms_candidate_references (tenant_id, candidate_id);
-- Defense-in-depth against duplicate references (same person by email/phone) beyond
-- the app-level check, in case of a future direct write path.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_candidate_references_email_uq
  ON candidate.hrms_candidate_references (tenant_id, candidate_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hrms_candidate_references_phone_uq
  ON candidate.hrms_candidate_references (tenant_id, candidate_id, phone) WHERE phone IS NOT NULL;

ALTER TABLE candidate.hrms_candidate_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate.hrms_candidate_references FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_candidate_references_tenant_isolation ON candidate.hrms_candidate_references;
CREATE POLICY hrms_candidate_references_tenant_isolation ON candidate.hrms_candidate_references
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON candidate.hrms_candidate_references TO hrms_svc;
