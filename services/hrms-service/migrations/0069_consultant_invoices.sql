-- 0069_consultant_invoices.sql
-- DIC Consultant/Invoice module (Phase 3). Consultants (engagement type
-- 'consultant', payment_route 'invoice') are excluded from payroll + leave; this
-- gives them their positive pay path: submit invoice -> verify -> approve
-- (194J TDS + optional GST computed) -> mark paid, with an outbox event for
-- Finance AP. Money in paise (bigint). Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS consultant.hrms_consultant_invoices;
--           DROP SCHEMA IF EXISTS consultant;

CREATE SCHEMA IF NOT EXISTS consultant;

CREATE TABLE IF NOT EXISTS consultant.hrms_consultant_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  consultant_id       uuid NOT NULL,                       -- hrms_employees.id (employeeType consultant)
  invoice_no          varchar(64) NOT NULL,               -- vendor's invoice number
  invoice_date        date NOT NULL,
  period_from         date,
  period_to           date,
  description         text,
  currency            varchar(3) NOT NULL DEFAULT 'INR',
  gross_minor         bigint NOT NULL,                    -- professional fee before GST/TDS
  gst_applicable      boolean NOT NULL DEFAULT false,
  gst_rate_bps        integer NOT NULL DEFAULT 0,         -- basis points (1800 = 18%)
  gst_minor           bigint NOT NULL DEFAULT 0,
  gstin               varchar(15),
  sac_code            varchar(6),
  tds_section         varchar(8) NOT NULL DEFAULT '194J',
  tds_rate_bps        integer NOT NULL DEFAULT 1000,      -- 194J default 10%
  tds_minor           bigint NOT NULL DEFAULT 0,
  net_payable_minor   bigint NOT NULL DEFAULT 0,
  status              varchar(16) NOT NULL DEFAULT 'submitted',
  remarks             text,
  approver_remarks    text,
  payment_ref         varchar(64),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  verified_by         uuid,
  verified_at         timestamptz,
  approved_by         uuid,
  approved_at         timestamptz,
  paid_at             timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  CONSTRAINT hrms_consultant_invoices_status_check
    CHECK (status IN ('submitted','verified','approved','rejected','paid')),
  CONSTRAINT hrms_consultant_invoices_gross_positive
    CHECK (gross_minor > 0)
);

-- One invoice number per consultant per tenant (idempotent re-submit guard).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_consultant_invoices_no_uq
  ON consultant.hrms_consultant_invoices (tenant_id, consultant_id, invoice_no);

CREATE INDEX IF NOT EXISTS hrms_consultant_invoices_consultant_idx
  ON consultant.hrms_consultant_invoices (tenant_id, consultant_id);
CREATE INDEX IF NOT EXISTS hrms_consultant_invoices_status_idx
  ON consultant.hrms_consultant_invoices (tenant_id, status);

-- RLS (FORCE — same pattern as medical.hrms_medical_claims / app.tenant_id GUC).
ALTER TABLE consultant.hrms_consultant_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant.hrms_consultant_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_consultant_invoices_tenant_isolation ON consultant.hrms_consultant_invoices;
CREATE POLICY hrms_consultant_invoices_tenant_isolation ON consultant.hrms_consultant_invoices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Runtime role grants (a brand-new schema does not inherit default privileges).
GRANT USAGE ON SCHEMA consultant TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON consultant.hrms_consultant_invoices TO hrms_svc;
