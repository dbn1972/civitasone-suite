-- 0073_recruitment_requisitions.sql
-- First-class Recruitment Requisition (checklist "Job requisition", R-RA-0048..0062):
-- the internal, approval-gated hiring authorisation that sits BETWEEN the manpower
-- plan and the published job opening. A requisition captures the full hiring
-- specification, routes through a configurable approval chain (hiring manager →
-- HR → finance → competent authority for Government) with full audit history, and
-- may only be PUBLISHED as a job opening after every mandatory stage has approved.
-- Additive + idempotent. Money in paise (bigint).
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_requisition_approvals;
--           DROP TABLE IF EXISTS recruitment.hrms_requisitions;

CREATE TABLE IF NOT EXISTS recruitment.hrms_requisitions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  requisition_no      varchar(48) NOT NULL,
  title               varchar(200) NOT NULL,
  position_id         uuid,                                  -- approved position (optional)
  source_manpower_req_id uuid,                               -- generated from a manpower requisition (optional)
  reason              text,                                  -- reason for hiring
  employment_type     varchar(24) NOT NULL DEFAULT 'permanent',
  recruitment_mode    varchar(24) NOT NULL DEFAULT 'direct', -- direct|deputation|absorption|promotion|contract|consultant
  campaign_type       varchar(24) NOT NULL DEFAULT 'direct', -- direct|campus|walkin|referral|lateral|apprenticeship|mass
  department_id       uuid,
  designation_id      uuid,
  grade               varchar(48),
  location            varchar(200),
  vacancies           integer NOT NULL DEFAULT 1,
  experience_min_years integer NOT NULL DEFAULT 0,
  qualification       varchar(1000),
  skills              text,
  reservation         jsonb NOT NULL DEFAULT '{}'::jsonb,    -- category-wise vacancy split
  budget_minor        bigint,
  confidential        boolean NOT NULL DEFAULT false,
  agency_id           uuid,                                  -- empanelled agency / vendor allocation
  target_hire_date    date,
  sla_days            integer,
  approval_chain      jsonb NOT NULL DEFAULT '[]'::jsonb,    -- ordered [{stage,role}] mandatory approvers
  current_stage       integer NOT NULL DEFAULT -1,           -- -1 draft/not-submitted; else index into chain
  status              varchar(20) NOT NULL DEFAULT 'draft',
  hold_reason         text,
  close_reason        text,
  published_opening_id uuid,                                 -- the job opening created on publish
  submitted_at        timestamptz,
  approved_at         timestamptz,
  published_at        timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  CONSTRAINT hrms_requisitions_status_check
    CHECK (status IN ('draft','pending_approval','returned','approved','published','on_hold','cancelled','closed')),
  CONSTRAINT hrms_requisitions_mode_check
    CHECK (recruitment_mode IN ('direct','deputation','absorption','promotion','contract','consultant')),
  CONSTRAINT hrms_requisitions_campaign_check
    CHECK (campaign_type IN ('direct','campus','walkin','referral','lateral','apprenticeship','mass')),
  CONSTRAINT hrms_requisitions_vacancies_check CHECK (vacancies > 0)
);

-- Immutable audit trail of every approval-chain action (approve / return).
CREATE TABLE IF NOT EXISTS recruitment.hrms_requisition_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  requisition_id      uuid NOT NULL,
  stage               integer NOT NULL,
  stage_role          varchar(48) NOT NULL,
  action              varchar(12) NOT NULL,                  -- approve | return
  comments            text,
  actor_id            uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_requisition_approvals_action_check CHECK (action IN ('approve','return'))
);

CREATE UNIQUE INDEX IF NOT EXISTS hrms_requisitions_no_uq
  ON recruitment.hrms_requisitions (tenant_id, requisition_no);
CREATE INDEX IF NOT EXISTS hrms_requisitions_status_idx
  ON recruitment.hrms_requisitions (tenant_id, status);
CREATE INDEX IF NOT EXISTS hrms_requisition_approvals_req_idx
  ON recruitment.hrms_requisition_approvals (tenant_id, requisition_id, created_at);

-- RLS (FORCE, app.tenant_id GUC — same pattern as the rest of the recruitment schema).
ALTER TABLE recruitment.hrms_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_requisitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_requisitions_tenant_isolation ON recruitment.hrms_requisitions;
CREATE POLICY hrms_requisitions_tenant_isolation ON recruitment.hrms_requisitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE recruitment.hrms_requisition_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_requisition_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_requisition_approvals_tenant_isolation ON recruitment.hrms_requisition_approvals;
CREATE POLICY hrms_requisition_approvals_tenant_isolation ON recruitment.hrms_requisition_approvals
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_requisitions TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_requisition_approvals TO hrms_svc;
