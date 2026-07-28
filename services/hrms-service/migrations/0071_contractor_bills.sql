-- 0071_contractor_bills.sql
-- DIC Third-Party / Agency module (Phase 3). Third-party workers (engagement
-- type 'third_party') are deployed via a licensed contractor/agency; DIC is the
-- CLRA principal employer and pays the AGENCY, not the worker — §194C TDS,
-- optional GST, and CLRA compliance (valid labour licence + verified wage
-- disbursement to the deployed workers).
--
-- Two tables: hrms_contractors (agency master + CLRA licence) and
-- hrms_contractor_bills (submit -> verify -> approve[§194C TDS + GST] -> paid).
-- Money in paise (bigint). Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS agency.hrms_contractor_bills;
--           DROP TABLE IF EXISTS agency.hrms_contractors; DROP SCHEMA IF EXISTS agency;

CREATE SCHEMA IF NOT EXISTS agency;

CREATE TABLE IF NOT EXISTS agency.hrms_contractors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  name                  varchar(200) NOT NULL,
  contractor_kind       varchar(16) NOT NULL DEFAULT 'other',  -- individual_huf | other (194C rate)
  clra_license_no       varchar(64),
  clra_license_valid_till date,
  pan                   varchar(10),
  gstin                 varchar(15),
  contact_email         varchar(120),
  contact_phone         varchar(20),
  status                varchar(16) NOT NULL DEFAULT 'active',  -- active | blacklisted
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  CONSTRAINT hrms_contractors_kind_check   CHECK (contractor_kind IN ('individual_huf','other')),
  CONSTRAINT hrms_contractors_status_check CHECK (status IN ('active','blacklisted'))
);

CREATE TABLE IF NOT EXISTS agency.hrms_contractor_bills (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  contractor_id             uuid NOT NULL,
  bill_no                   varchar(64) NOT NULL,
  bill_date                 date NOT NULL,
  period_from               date,
  period_to                 date,
  description               text,
  workers_count             integer NOT NULL DEFAULT 0,
  wages_disbursed_verified  boolean NOT NULL DEFAULT false,     -- CLRA principal-employer attestation
  currency                  varchar(3) NOT NULL DEFAULT 'INR',
  gross_minor               bigint NOT NULL,                    -- labour charges before GST/TDS
  gst_applicable            boolean NOT NULL DEFAULT false,
  gst_rate_bps              integer NOT NULL DEFAULT 0,
  gst_minor                 bigint NOT NULL DEFAULT 0,
  gstin                     varchar(15),
  tds_section               varchar(8) NOT NULL DEFAULT '194C',
  tds_rate_bps              integer NOT NULL DEFAULT 0,          -- resolved at approval from contractor_kind
  tds_minor                 bigint NOT NULL DEFAULT 0,
  net_payable_minor         bigint NOT NULL DEFAULT 0,
  status                    varchar(16) NOT NULL DEFAULT 'submitted',
  remarks                   text,
  approver_remarks          text,
  payment_ref               varchar(64),
  submitted_at              timestamptz NOT NULL DEFAULT now(),
  verified_by               uuid,
  verified_at               timestamptz,
  approved_by               uuid,
  approved_at               timestamptz,
  paid_at                   timestamptz,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  updated_by                uuid NOT NULL,
  CONSTRAINT hrms_contractor_bills_status_check
    CHECK (status IN ('submitted','verified','approved','rejected','paid')),
  CONSTRAINT hrms_contractor_bills_gross_positive CHECK (gross_minor > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS hrms_contractor_bills_no_uq
  ON agency.hrms_contractor_bills (tenant_id, contractor_id, bill_no);
CREATE INDEX IF NOT EXISTS hrms_contractors_tenant_idx    ON agency.hrms_contractors (tenant_id);
CREATE INDEX IF NOT EXISTS hrms_contractor_bills_ctr_idx  ON agency.hrms_contractor_bills (tenant_id, contractor_id);
CREATE INDEX IF NOT EXISTS hrms_contractor_bills_stat_idx ON agency.hrms_contractor_bills (tenant_id, status);

-- RLS (FORCE, app.tenant_id GUC — same pattern as consultant / medical).
ALTER TABLE agency.hrms_contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency.hrms_contractors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_contractors_tenant_isolation ON agency.hrms_contractors;
CREATE POLICY hrms_contractors_tenant_isolation ON agency.hrms_contractors
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE agency.hrms_contractor_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency.hrms_contractor_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_contractor_bills_tenant_isolation ON agency.hrms_contractor_bills;
CREATE POLICY hrms_contractor_bills_tenant_isolation ON agency.hrms_contractor_bills
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Runtime role grants (brand-new schema does not inherit default privileges).
GRANT USAGE ON SCHEMA agency TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agency.hrms_contractors TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON agency.hrms_contractor_bills TO hrms_svc;
