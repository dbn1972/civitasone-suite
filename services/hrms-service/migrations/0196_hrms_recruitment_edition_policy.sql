-- 0196_hrms_recruitment_edition_policy.sql
--
-- GAP-RECRUITMENT-NEW-06: per-edition recruitment policy. One row per tenant:
--   edition             -- the packaged edition this tenant runs ('govt' | 'psu' | 'small_office').
--   require_requisition -- NULL = follow the edition default (ON for 'govt', OFF otherwise);
--                          TRUE/FALSE = explicit per-tenant override.
-- When the effective value is ON, POST /v1/hrms/job-openings (and the JD-template "use" path) is
-- refused: a vacancy must originate from a fully approved requisition (POST /requisitions/:id/publish,
-- R-RA-0056). No row == 'small_office' == today's behaviour, so applying this migration changes nothing.
-- Additive + idempotent.
-- Rollback: DROP TABLE recruitment.hrms_recruitment_edition_policy;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recruitment.hrms_recruitment_edition_policy (
  tenant_id           uuid        PRIMARY KEY,
  edition             varchar(16) NOT NULL DEFAULT 'small_office',
  require_requisition boolean,
  updated_by          uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1
);

DO $$ BEGIN
  ALTER TABLE recruitment.hrms_recruitment_edition_policy ADD CONSTRAINT hrms_recruitment_edition_policy_edition_chk
    CHECK (edition IN ('govt','psu','small_office'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE recruitment.hrms_recruitment_edition_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_recruitment_edition_policy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recruitment.hrms_recruitment_edition_policy;
CREATE POLICY tenant_isolation_policy ON recruitment.hrms_recruitment_edition_policy
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_recruitment_edition_policy TO hrms_svc;
