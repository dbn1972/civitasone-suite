-- 0089_qualification_requirement.sql
-- Screening & shortlisting — per-job experience + education requirement, used to
-- validate a candidate's experience (duration/overlaps/gaps/relevance, R-RA-0108)
-- and education (level/discipline/institution, R-RA-0109). New table, FORCE RLS.
-- Additive + idempotent.
--
-- Rollback: DROP TABLE recruitment.hrms_qualification_requirements;

CREATE TABLE IF NOT EXISTS recruitment.hrms_qualification_requirements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  job_opening_id              uuid NOT NULL,
  min_total_years             numeric(4,1),
  min_relevant_years          numeric(4,1),
  max_gap_months              integer,
  min_education_level         varchar(24),
  required_disciplines        jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_percentage              numeric(5,2),
  recognised_institutions_only boolean NOT NULL DEFAULT false,
  created_by                  uuid NOT NULL,
  updated_by                  uuid NOT NULL,
  version                     integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_qualification_requirements_job_uq UNIQUE (tenant_id, job_opening_id)
);

ALTER TABLE recruitment.hrms_qualification_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_qualification_requirements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_qualification_requirements_tenant_isolation ON recruitment.hrms_qualification_requirements;
CREATE POLICY hrms_qualification_requirements_tenant_isolation ON recruitment.hrms_qualification_requirements
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_qualification_requirements TO hrms_svc;
