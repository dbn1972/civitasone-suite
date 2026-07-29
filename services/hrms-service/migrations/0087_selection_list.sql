-- 0087_selection_list.sql
-- Selection & offer — selection list + waitlist with validity (checklist R-RA-0153).
--   A merit list at the job-opening level, produced after approved evaluation:
--   ranked SELECTED candidates (up to the number of vacancies) plus a ranked
--   WAITLIST, approved by the competent authority with a validity period.
-- New tables in the recruitment schema. FORCE RLS. Additive + idempotent.
--
-- Rollback: DROP TABLE recruitment.hrms_selection_list_entries, recruitment.hrms_selection_lists;

CREATE TABLE IF NOT EXISTS recruitment.hrms_selection_lists (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  job_opening_id uuid NOT NULL,
  title          varchar(256) NOT NULL,
  vacancies      integer NOT NULL,
  status         varchar(16) NOT NULL DEFAULT 'draft',   -- draft | approved | published | expired
  validity_until date,
  created_by     uuid NOT NULL,
  entries_set_by uuid,          -- who last authored the ranking (for SoD vs approver)
  entries_set_at timestamptz,
  approved_by    uuid,
  approved_at    timestamptz,
  published_at   timestamptz,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_selection_lists_status_check CHECK (status IN ('draft','approved','published','expired')),
  CONSTRAINT hrms_selection_lists_vacancies_check CHECK (vacancies >= 1)
);
CREATE INDEX IF NOT EXISTS hrms_selection_lists_job_idx
  ON recruitment.hrms_selection_lists (tenant_id, job_opening_id);

CREATE TABLE IF NOT EXISTS recruitment.hrms_selection_list_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  list_id        uuid NOT NULL,
  application_id uuid NOT NULL,
  candidate_name varchar(256) NOT NULL,
  category       varchar(16) NOT NULL,                   -- selected | waitlist
  rank           integer NOT NULL,
  score          numeric(8,2),
  remarks        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_selection_list_entries_category_check CHECK (category IN ('selected','waitlist')),
  CONSTRAINT hrms_selection_list_entries_rank_check CHECK (rank >= 1),
  CONSTRAINT hrms_selection_list_entries_app_uq  UNIQUE (list_id, application_id),
  CONSTRAINT hrms_selection_list_entries_rank_uq UNIQUE (list_id, category, rank)
);
CREATE INDEX IF NOT EXISTS hrms_selection_list_entries_list_idx
  ON recruitment.hrms_selection_list_entries (tenant_id, list_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_selection_lists','hrms_selection_list_entries']
  LOOP
    EXECUTE format('ALTER TABLE recruitment.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE recruitment.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON recruitment.%I', t||'_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON recruitment.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t||'_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.%I TO hrms_svc', t);
  END LOOP;
END $$;
