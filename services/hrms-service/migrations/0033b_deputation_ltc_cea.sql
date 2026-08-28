-- 0033b_deputation_ltc_cea.sql
-- Deputation lifecycle + LTC and CEA claim modules.
-- Additive + idempotent only. Money in paise (bigint).
--
-- Renumbered 2026-08-27: this file's own header already called itself
-- "0020_..." (its intended slot), but it was checked in as 0120 — 100 past
-- where it was meant to sort — while 0034/0035/0038 reference the tables
-- created here (lifecycle.hrms_deputations, claims.hrms_ltc_claims,
-- claims.hrms_cea_claims) starting at file 0034. Moved to the smallest slot
-- that sorts before that earliest consumer. Content otherwise unchanged.

-- ============================================================
-- 1. Deputation lifecycle (lives in the lifecycle schema)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS lifecycle;

CREATE TABLE IF NOT EXISTS lifecycle.hrms_deputations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  employee_id              uuid NOT NULL,
  parent_cadre             varchar(120) NOT NULL,
  parent_department_id     uuid NOT NULL,
  parent_manager_id        uuid,
  borrowing_department     varchar(160) NOT NULL,
  borrowing_department_id  uuid,
  borrowing_manager_id     uuid,
  deputation_allowance_minor bigint NOT NULL DEFAULT 0,
  tenure_from              date NOT NULL,
  tenure_to                date NOT NULL,
  status                   varchar(16) NOT NULL DEFAULT 'active',
  repatriated_on           date,
  repatriation_note        text,
  order_ref                varchar(120),
  remarks                  text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL,
  updated_by               uuid NOT NULL,
  version                  integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_deputations_status_check CHECK (status IN ('active','repatriated','cancelled')),
  CONSTRAINT hrms_deputations_tenure_check CHECK (tenure_to > tenure_from)
);
CREATE INDEX IF NOT EXISTS hrms_deputations_emp_idx
  ON lifecycle.hrms_deputations (tenant_id, employee_id, status);
-- At most one ACTIVE deputation per employee.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_deputations_active_uq
  ON lifecycle.hrms_deputations (tenant_id, employee_id)
  WHERE status = 'active';

-- ============================================================
-- 2. LTC / CEA claims (new schema: claims)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS claims;

-- LTC (Leave Travel Concession): block-year eligibility, hometown/all-India,
-- fare reimbursement with submit -> approve and ceiling enforcement.
CREATE TABLE IF NOT EXISTS claims.hrms_ltc_claims (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  employee_id         uuid NOT NULL,
  block_year          varchar(16) NOT NULL,            -- e.g. '2022-2025'
  ltc_type            varchar(16) NOT NULL,            -- hometown | all_india
  journey_from        varchar(120) NOT NULL,
  journey_to          varchar(120) NOT NULL,
  travel_date         date NOT NULL,
  family_members      integer NOT NULL DEFAULT 1,
  claimed_fare_minor  bigint NOT NULL,
  entitlement_minor   bigint NOT NULL,                 -- ceiling for this claim
  approved_fare_minor bigint,                          -- min(claimed, entitlement)
  status              varchar(16) NOT NULL DEFAULT 'submitted',
  remarks             text,
  approver_remarks    text,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  decided_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_ltc_type_check CHECK (ltc_type IN ('hometown','all_india')),
  CONSTRAINT hrms_ltc_status_check CHECK (status IN ('submitted','approved','rejected','cancelled')),
  CONSTRAINT hrms_ltc_fare_check CHECK (claimed_fare_minor >= 0 AND entitlement_minor >= 0)
);
CREATE INDEX IF NOT EXISTS hrms_ltc_emp_idx
  ON claims.hrms_ltc_claims (tenant_id, employee_id, block_year);

-- CEA (Children Education Allowance): per-child annual cap + hostel subsidy.
CREATE TABLE IF NOT EXISTS claims.hrms_cea_claims (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  employee_id         uuid NOT NULL,
  academic_year       varchar(16) NOT NULL,            -- e.g. '2025-2026'
  child_name          varchar(120) NOT NULL,
  child_ref           varchar(64) NOT NULL,            -- stable per-child key for cap aggregation
  claim_kind          varchar(16) NOT NULL,            -- tuition | hostel
  claimed_amount_minor  bigint NOT NULL,
  annual_cap_minor    bigint NOT NULL,                 -- per-child annual ceiling for this kind
  approved_amount_minor bigint,
  status              varchar(16) NOT NULL DEFAULT 'submitted',
  remarks             text,
  approver_remarks    text,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  decided_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_cea_kind_check CHECK (claim_kind IN ('tuition','hostel')),
  CONSTRAINT hrms_cea_status_check CHECK (status IN ('submitted','approved','rejected','cancelled')),
  CONSTRAINT hrms_cea_amt_check CHECK (claimed_amount_minor >= 0 AND annual_cap_minor >= 0)
);
CREATE INDEX IF NOT EXISTS hrms_cea_emp_idx
  ON claims.hrms_cea_claims (tenant_id, employee_id, academic_year, child_ref);
