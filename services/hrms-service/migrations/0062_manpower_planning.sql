-- 0062_manpower_planning.sql  (SVC-003 — Manpower Planning & Recruitment Requisition)
--
-- Turns workforce-planning from READ-ONLY analytics into a PERSISTED
-- manpower-plan lifecycle. New `manpower` schema:
--   • plans        — one plan per (unit, cadre, plan_year); required vs
--                    sanctioned vs filled → computed vacancy; maker-checker
--                    approval (approved_by MUST differ from created_by, enforced
--                    at the app layer).
--   • plan_roster  — category-wise reservation-roster inputs per plan.
--   • requisitions — recruitment requisitions GENERATED from an approved plan;
--                    linked to a recruitment.hrms_job_openings row via
--                    job_opening_id (the same id emitted on the hrms.job.create
--                    outbox command), plus advertisement linkage and a
--                    filled_count that closes the loop from hire events.
--
-- Additive + idempotent (IF NOT EXISTS). Money/marks n/a. RLS below mirrors
-- 0026_rls_tenant_isolation.sql / 0044_rls_assessment.sql: a schema-local
-- current_tenant_id() reading the app.tenant_id GUC (fail-closed), then
-- ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy per table.
--
-- Rollback: DROP SCHEMA IF EXISTS manpower CASCADE;

CREATE SCHEMA IF NOT EXISTS manpower;

CREATE TABLE IF NOT EXISTS manpower.plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  plan_year            integer NOT NULL,
  unit_id              uuid NOT NULL,               -- department / office unit
  cadre                varchar(120) NOT NULL,
  designation_id       uuid,
  required_strength    integer NOT NULL DEFAULT 0,  -- planners' requirement
  sanctioned_strength  integer NOT NULL DEFAULT 0,  -- sanctioned posts
  filled_strength      integer NOT NULL DEFAULT 0,  -- current on-roll; grows on hire
  remarks              text,
  status               varchar(24) NOT NULL DEFAULT 'draft',
  created_by           uuid NOT NULL,
  approved_by          uuid,
  submitted_at         timestamptz,
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT plans_status_check CHECK (status IN ('draft','pending_approval','approved','rejected','closed')),
  CONSTRAINT plans_required_nonneg    CHECK (required_strength   >= 0),
  CONSTRAINT plans_sanctioned_nonneg  CHECK (sanctioned_strength >= 0),
  CONSTRAINT plans_filled_nonneg      CHECK (filled_strength     >= 0),
  CONSTRAINT plans_year_range         CHECK (plan_year BETWEEN 1900 AND 3000),
  CONSTRAINT plans_unique_unit_cadre_year UNIQUE (tenant_id, unit_id, cadre, plan_year)
);

CREATE TABLE IF NOT EXISTS manpower.plan_roster (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  plan_id        uuid NOT NULL REFERENCES manpower.plans(id) ON DELETE CASCADE,
  category       varchar(8) NOT NULL,               -- SC/ST/OBC/EWS/UR/PwD
  reserved_count integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_roster_category_check CHECK (category IN ('SC','ST','OBC','EWS','UR','PwD')),
  CONSTRAINT plan_roster_count_nonneg   CHECK (reserved_count >= 0),
  CONSTRAINT plan_roster_unique_cat     UNIQUE (tenant_id, plan_id, category)
);

CREATE TABLE IF NOT EXISTS manpower.requisitions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  plan_id             uuid NOT NULL REFERENCES manpower.plans(id) ON DELETE CASCADE,
  requisition_no      text NOT NULL,
  unit_id             uuid NOT NULL,
  cadre               varchar(120) NOT NULL,
  designation_id      uuid,
  requested_vacancies integer NOT NULL DEFAULT 0,
  filled_count        integer NOT NULL DEFAULT 0,   -- closes the loop on hire
  job_opening_id      uuid NOT NULL,                -- == hrms.job.create payload.id
  advertisement_ref   varchar(200),
  status              varchar(24) NOT NULL DEFAULT 'emitted',
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT requisitions_status_check CHECK (status IN ('emitted','advertised','filled','closed')),
  CONSTRAINT requisitions_vacancies_nonneg CHECK (requested_vacancies >= 0),
  CONSTRAINT requisitions_filled_nonneg    CHECK (filled_count >= 0),
  CONSTRAINT requisitions_unique_no        UNIQUE (tenant_id, requisition_no)
);

-- Indexes (tenant-leading, mirrors the service convention)
CREATE INDEX IF NOT EXISTS plans_tenant_idx           ON manpower.plans (tenant_id, status);
CREATE INDEX IF NOT EXISTS plans_unit_year_idx         ON manpower.plans (tenant_id, unit_id, plan_year);
CREATE INDEX IF NOT EXISTS plan_roster_plan_idx        ON manpower.plan_roster (tenant_id, plan_id);
CREATE INDEX IF NOT EXISTS requisitions_plan_idx       ON manpower.requisitions (tenant_id, plan_id);
CREATE INDEX IF NOT EXISTS requisitions_job_open_idx   ON manpower.requisitions (tenant_id, job_opening_id);

-- Privileges: the runtime role (hrms_svc, NOBYPASSRLS) must be able to use the
-- new schema + its tables. New schemas do not inherit ALTER DEFAULT PRIVILEGES
-- granted for the pre-existing schemas, so grant explicitly here.
GRANT USAGE ON SCHEMA manpower TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA manpower TO hrms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA manpower
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_svc;

-- ── Row-Level Security (FORCE) ────────────────────────────────────
CREATE OR REPLACE FUNCTION manpower.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

ALTER TABLE manpower.plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE manpower.plan_roster  ENABLE ROW LEVEL SECURITY;
ALTER TABLE manpower.requisitions ENABLE ROW LEVEL SECURITY;

ALTER TABLE manpower.plans        FORCE ROW LEVEL SECURITY;
ALTER TABLE manpower.plan_roster  FORCE ROW LEVEL SECURITY;
ALTER TABLE manpower.requisitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON manpower.plans;
DROP POLICY IF EXISTS tenant_isolation ON manpower.plan_roster;
DROP POLICY IF EXISTS tenant_isolation ON manpower.requisitions;

CREATE POLICY tenant_isolation ON manpower.plans        USING (tenant_id = manpower.current_tenant_id());
CREATE POLICY tenant_isolation ON manpower.plan_roster  USING (tenant_id = manpower.current_tenant_id());
CREATE POLICY tenant_isolation ON manpower.requisitions USING (tenant_id = manpower.current_tenant_id());
