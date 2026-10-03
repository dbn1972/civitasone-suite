-- 0059_payroll_letterhead_and_return_filings.sql
-- fin-payroll-01.
--
-- 1) payroll.payroll_letterhead -- GAP-PAYROLL-SALARY-SLIPS-DETAIL-02. The
--    printable salary slip used to print a hard-coded product name and a
--    "Government of India" authority line for EVERY tenant. The issuing
--    organisation is now the tenant's own, one row per tenant: organisation
--    name (required), department, DDO name/code, address, signatory title and
--    whether the slip carries a signature block. No row = the slip prints no
--    authority line at all (it never invents one).
--
-- 2) payroll.statutory_return_filings -- GAP-PAYROLL-RETURNS-01. A quarter
--    reconciled with TRACES is not a quarter that has been FILED. This is the
--    filing record: when the e-TDS statement was filed and the provisional
--    receipt number (PRN, 15 digits) NSDL issued for it. Recorded by a
--    payroll operator after filing on the TIN-NSDL portal (there is no
--    TRACES/NSDL integration here); one row per (tenant, form, fy, quarter);
--    a correction statement is a NEW filing recorded as a revision.
--
-- Both tables: FORCE RLS on tenant_id like every payroll.* table.
--
-- Rollback:
--   DROP TABLE IF EXISTS payroll.statutory_return_filings;
--   DROP TABLE IF EXISTS payroll.payroll_letterhead;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS payroll.payroll_letterhead (
  tenant_id        uuid PRIMARY KEY,
  org_name         varchar(160) NOT NULL,
  department       varchar(160),
  ddo_name         varchar(160),
  ddo_code         varchar(32),
  address          varchar(400),
  signatory_title  varchar(120),
  show_signature_block boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_letterhead_org_name_check CHECK (btrim(org_name) <> '')
);
ALTER TABLE payroll.payroll_letterhead ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_letterhead FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_letterhead;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_letterhead
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

CREATE TABLE IF NOT EXISTS payroll.statutory_return_filings (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  form_type        varchar(8)  NOT NULL DEFAULT '24Q',
  fy               varchar(7)  NOT NULL,
  quarter          varchar(2)  NOT NULL,
  filed_on         date        NOT NULL,
  receipt_no       varchar(15) NOT NULL,
  revision         integer     NOT NULL DEFAULT 0,
  note             varchar(500),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by      uuid NOT NULL,
  CONSTRAINT statutory_return_filings_form_check    CHECK (form_type IN ('24Q', '26Q')),
  CONSTRAINT statutory_return_filings_quarter_check CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  CONSTRAINT statutory_return_filings_fy_check      CHECK (fy ~ '^\d{4}-\d{2}$'),
  CONSTRAINT statutory_return_filings_receipt_check CHECK (receipt_no ~ '^\d{15}$'),
  CONSTRAINT statutory_return_filings_revision_check CHECK (revision >= 0)
);
-- One filing per statement revision; revision 0 is the original statement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_statutory_return_filings_rev
  ON payroll.statutory_return_filings (tenant_id, form_type, fy, quarter, revision);
-- A provisional receipt number identifies exactly one statement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_statutory_return_filings_receipt
  ON payroll.statutory_return_filings (tenant_id, receipt_no);
ALTER TABLE payroll.statutory_return_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.statutory_return_filings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.statutory_return_filings;
CREATE POLICY tenant_isolation_policy ON payroll.statutory_return_filings
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
