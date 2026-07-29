-- 0079_candidate_profile.sql
-- Candidate identity & profile (checklist R-RA-0080/0081/0082/0084/0085/0089/0090/0091).
-- A first-class candidate master with identity + personal + reservation
-- attributes, education/employment history, versioned consent, submit field-lock,
-- and withdrawal — with duplicate prevention on verified email / mobile.
-- Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS candidate.hrms_candidate_employment,
--           candidate.hrms_candidate_education, candidate.hrms_candidates;
--           DROP SCHEMA IF EXISTS candidate;

CREATE SCHEMA IF NOT EXISTS candidate;

CREATE TABLE IF NOT EXISTS candidate.hrms_candidates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  -- identity
  email              varchar(200) NOT NULL,
  normalized_email   varchar(200) NOT NULL,               -- lower(email), for dedup
  mobile             varchar(20),
  normalized_mobile  varchar(10),
  email_verified     boolean NOT NULL DEFAULT false,
  mobile_verified    boolean NOT NULL DEFAULT false,
  resume_fingerprint varchar(128),                        -- hash of the active resume
  -- personal (R-RA-0081)
  full_name          varchar(200),
  date_of_birth      date,
  gender             varchar(16),
  marital_status     varchar(16),
  nationality        varchar(64),
  guardian_name      varchar(200),
  correspondence_address text,
  permanent_address  text,
  -- reservation (R-RA-0082)
  category           varchar(8),
  sub_category       varchar(32),
  disability         boolean NOT NULL DEFAULT false,
  ex_serviceman      boolean NOT NULL DEFAULT false,
  active_resume_ref  varchar(512),
  -- consent (R-RA-0090)
  consent_version    varchar(24),
  consent_accepted_at timestamptz,
  -- lifecycle
  status             varchar(16) NOT NULL DEFAULT 'draft', -- draft | submitted | withdrawn
  submitted_at       timestamptz,
  withdrawn_at       timestamptz,
  data_request_at    timestamptz,                          -- DPDP data/erasure request (R-RA-0091)
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  CONSTRAINT hrms_candidates_status_check CHECK (status IN ('draft','submitted','withdrawn')),
  CONSTRAINT hrms_candidates_category_check
    CHECK (category IS NULL OR category IN ('GEN','OBC','SC','ST','EWS'))
);

-- Duplicate prevention (R-RA-0080): one active candidate per verified email /
-- mobile per tenant. Withdrawn profiles are exempt so a person can re-register.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_candidates_email_uq
  ON candidate.hrms_candidates (tenant_id, normalized_email) WHERE status <> 'withdrawn';
CREATE UNIQUE INDEX IF NOT EXISTS hrms_candidates_mobile_uq
  ON candidate.hrms_candidates (tenant_id, normalized_mobile)
  WHERE normalized_mobile IS NOT NULL AND status <> 'withdrawn';
-- Resume-fingerprint duplicate prevention is race-safe too (a hard 23505, like
-- email/mobile), not just an app-level pre-check. NULL fingerprints exempt.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_candidates_fingerprint_uq
  ON candidate.hrms_candidates (tenant_id, resume_fingerprint)
  WHERE resume_fingerprint IS NOT NULL AND status <> 'withdrawn';

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_education (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  candidate_id uuid NOT NULL,
  qualification varchar(120) NOT NULL,
  subject      varchar(200),
  institution  varchar(200),
  board_university varchar(200),
  year_of_passing integer,
  marks_percent  numeric(5,2),
  grade        varchar(16),
  verification_status varchar(16) NOT NULL DEFAULT 'unverified',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate.hrms_candidate_employment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  candidate_id uuid NOT NULL,
  employer     varchar(200) NOT NULL,
  role_title   varchar(200),
  from_date    date,
  to_date      date,
  notice_period_days integer,
  ctc_minor    bigint,
  reason_for_leaving text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS hrms_candidate_education_cand_idx
  ON candidate.hrms_candidate_education (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS hrms_candidate_employment_cand_idx
  ON candidate.hrms_candidate_employment (tenant_id, candidate_id);

-- RLS (FORCE, app.tenant_id GUC).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_candidates','hrms_candidate_education','hrms_candidate_employment']
  LOOP
    EXECUTE format('ALTER TABLE candidate.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE candidate.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON candidate.%I', t||'_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON candidate.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t||'_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON candidate.%I TO hrms_svc', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA candidate TO hrms_svc;
