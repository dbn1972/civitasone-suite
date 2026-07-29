-- 0088_reservation_roster.sql
-- Screening & shortlisting — reservation roster + category/location shortlist
-- (checklist R-RA-0116). Stores the vertical reservation roster (UR/SC/ST/OBC/EWS)
-- per job opening; the category-wise / location-wise shortlist is computed from it.
-- New table in the recruitment schema. FORCE RLS. Additive + idempotent.
--
-- Rollback: DROP TABLE recruitment.hrms_reservation_rosters;

CREATE TABLE IF NOT EXISTS recruitment.hrms_reservation_rosters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  job_opening_id     uuid NOT NULL,
  total_vacancies    integer NOT NULL,
  category_vacancies jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {UR,SC,ST,OBC,EWS}
  location_rosters   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {location: {UR,SC,...}}
  status             varchar(16) NOT NULL DEFAULT 'draft', -- draft | approved
  approved_by        uuid,
  approved_at        timestamptz,
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_reservation_rosters_status_check CHECK (status IN ('draft','approved')),
  CONSTRAINT hrms_reservation_rosters_total_check CHECK (total_vacancies >= 1),
  CONSTRAINT hrms_reservation_rosters_job_uq UNIQUE (tenant_id, job_opening_id)
);

ALTER TABLE recruitment.hrms_reservation_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_reservation_rosters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_reservation_rosters_tenant_isolation ON recruitment.hrms_reservation_rosters;
CREATE POLICY hrms_reservation_rosters_tenant_isolation ON recruitment.hrms_reservation_rosters
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_reservation_rosters TO hrms_svc;
