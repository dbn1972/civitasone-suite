-- RLS completion: full tenant isolation (USING + WITH CHECK) for payroll-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION payroll.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- loans.payroll_loan_repayments
ALTER TABLE loans.payroll_loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans.payroll_loan_repayments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON loans.payroll_loan_repayments;
DROP POLICY IF EXISTS tenant_isolation ON loans.payroll_loan_repayments;
CREATE POLICY tenant_isolation_policy ON loans.payroll_loan_repayments
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- loans.payroll_loans
ALTER TABLE loans.payroll_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans.payroll_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON loans.payroll_loans;
DROP POLICY IF EXISTS tenant_isolation ON loans.payroll_loans;
CREATE POLICY tenant_isolation_policy ON loans.payroll_loans
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.dsc_config
ALTER TABLE payroll.dsc_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.dsc_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.dsc_config;
DROP POLICY IF EXISTS tenant_isolation ON payroll.dsc_config;
CREATE POLICY tenant_isolation_policy ON payroll.dsc_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.fnf_settlements
ALTER TABLE payroll.fnf_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.fnf_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.fnf_settlements;
DROP POLICY IF EXISTS tenant_isolation ON payroll.fnf_settlements;
CREATE POLICY tenant_isolation_policy ON payroll.fnf_settlements
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.form16_bulk_jobs
ALTER TABLE payroll.form16_bulk_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.form16_bulk_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.form16_bulk_jobs;
DROP POLICY IF EXISTS tenant_isolation ON payroll.form16_bulk_jobs;
CREATE POLICY tenant_isolation_policy ON payroll.form16_bulk_jobs
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.ltc_exemptions
ALTER TABLE payroll.ltc_exemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.ltc_exemptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.ltc_exemptions;
DROP POLICY IF EXISTS tenant_isolation ON payroll.ltc_exemptions;
CREATE POLICY tenant_isolation_policy ON payroll.ltc_exemptions
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.nach_return_records
ALTER TABLE payroll.nach_return_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.nach_return_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.nach_return_records;
DROP POLICY IF EXISTS tenant_isolation ON payroll.nach_return_records;
CREATE POLICY tenant_isolation_policy ON payroll.nach_return_records
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_components
ALTER TABLE payroll.payroll_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_components;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_components;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_components
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_ddo_departments
ALTER TABLE payroll.payroll_ddo_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_ddo_departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_ddo_departments;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_ddo_departments;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_ddo_departments
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_ddos
ALTER TABLE payroll.payroll_ddos ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_ddos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_ddos;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_ddos;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_ddos
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_lop_ledger
ALTER TABLE payroll.payroll_lop_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_lop_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_lop_ledger;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_lop_ledger;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_lop_ledger
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_pensioners
ALTER TABLE payroll.payroll_pensioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_pensioners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_pensioners;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_pensioners;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_pensioners
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_runs
ALTER TABLE payroll.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_runs;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_runs;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_runs
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_slips
ALTER TABLE payroll.payroll_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_slips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_slips;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_slips;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_slips
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_structures
ALTER TABLE payroll.payroll_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_structures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_structures;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_structures;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_structures
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.payroll_tax_declarations
ALTER TABLE payroll.payroll_tax_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_tax_declarations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_tax_declarations;
DROP POLICY IF EXISTS tenant_isolation ON payroll.payroll_tax_declarations;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_tax_declarations
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.perquisite_components
ALTER TABLE payroll.perquisite_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.perquisite_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.perquisite_components;
DROP POLICY IF EXISTS tenant_isolation ON payroll.perquisite_components;
CREATE POLICY tenant_isolation_policy ON payroll.perquisite_components
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- payroll.sponsor_bank_config
ALTER TABLE payroll.sponsor_bank_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.sponsor_bank_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.sponsor_bank_config;
DROP POLICY IF EXISTS tenant_isolation ON payroll.sponsor_bank_config;
CREATE POLICY tenant_isolation_policy ON payroll.sponsor_bank_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_esi
ALTER TABLE statutory.payroll_esi ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_esi FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_esi;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_esi;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_esi
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_gpf
ALTER TABLE statutory.payroll_gpf ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_gpf FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_gpf;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_gpf;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_gpf
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_gratuity
ALTER TABLE statutory.payroll_gratuity ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_gratuity FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_gratuity;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_gratuity;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_gratuity
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_nps
ALTER TABLE statutory.payroll_nps ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_nps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_nps;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_nps;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_nps
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_pf
ALTER TABLE statutory.payroll_pf ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_pf FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_pf;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_pf;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_pf
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_tds
ALTER TABLE statutory.payroll_tds ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_tds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_tds;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_tds;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_tds
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_tds_challan
ALTER TABLE statutory.payroll_tds_challan ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_tds_challan FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_tds_challan;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_tds_challan;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_tds_challan
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- statutory.payroll_tds_nonsalary
ALTER TABLE statutory.payroll_tds_nonsalary ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory.payroll_tds_nonsalary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON statutory.payroll_tds_nonsalary;
DROP POLICY IF EXISTS tenant_isolation ON statutory.payroll_tds_nonsalary;
CREATE POLICY tenant_isolation_policy ON statutory.payroll_tds_nonsalary
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = payroll.current_tenant_id())
      WITH CHECK (tenant_id = payroll.current_tenant_id())';
  END IF;
END $$;
