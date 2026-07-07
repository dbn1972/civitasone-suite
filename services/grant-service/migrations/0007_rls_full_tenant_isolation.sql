-- RLS completion: full tenant isolation (USING + WITH CHECK) for grant-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION scheme.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- application.grant_app_documents
ALTER TABLE application.grant_app_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_app_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON application.grant_app_documents;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_app_documents;
CREATE POLICY tenant_isolation_policy ON application.grant_app_documents
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- application.grant_applications
ALTER TABLE application.grant_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON application.grant_applications;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_applications;
CREATE POLICY tenant_isolation_policy ON application.grant_applications
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- application.grant_sanction_counters
ALTER TABLE application.grant_sanction_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_sanction_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON application.grant_sanction_counters;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_sanction_counters;
CREATE POLICY tenant_isolation_policy ON application.grant_sanction_counters
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- application.grant_scores
ALTER TABLE application.grant_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON application.grant_scores;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_scores;
CREATE POLICY tenant_isolation_policy ON application.grant_scores
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- beneficiary.grant_aadhaar_links
ALTER TABLE beneficiary.grant_aadhaar_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_aadhaar_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON beneficiary.grant_aadhaar_links;
DROP POLICY IF EXISTS tenant_isolation ON beneficiary.grant_aadhaar_links;
CREATE POLICY tenant_isolation_policy ON beneficiary.grant_aadhaar_links
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- beneficiary.grant_bank_accounts
ALTER TABLE beneficiary.grant_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_bank_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON beneficiary.grant_bank_accounts;
DROP POLICY IF EXISTS tenant_isolation ON beneficiary.grant_bank_accounts;
CREATE POLICY tenant_isolation_policy ON beneficiary.grant_bank_accounts
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- beneficiary.grant_beneficiaries
ALTER TABLE beneficiary.grant_beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_beneficiaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON beneficiary.grant_beneficiaries;
DROP POLICY IF EXISTS tenant_isolation ON beneficiary.grant_beneficiaries;
CREATE POLICY tenant_isolation_policy ON beneficiary.grant_beneficiaries
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- disbursement.grant_disbursements
ALTER TABLE disbursement.grant_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement.grant_disbursements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON disbursement.grant_disbursements;
DROP POLICY IF EXISTS tenant_isolation ON disbursement.grant_disbursements;
CREATE POLICY tenant_isolation_policy ON disbursement.grant_disbursements
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- disbursement.grant_installments
ALTER TABLE disbursement.grant_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement.grant_installments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON disbursement.grant_installments;
DROP POLICY IF EXISTS tenant_isolation ON disbursement.grant_installments;
CREATE POLICY tenant_isolation_policy ON disbursement.grant_installments
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- disbursement.grant_pfms_records
ALTER TABLE disbursement.grant_pfms_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement.grant_pfms_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON disbursement.grant_pfms_records;
DROP POLICY IF EXISTS tenant_isolation ON disbursement.grant_pfms_records;
CREATE POLICY tenant_isolation_policy ON disbursement.grant_pfms_records
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- scheme.grant_eligibility_criteria
ALTER TABLE scheme.grant_eligibility_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.grant_eligibility_criteria FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheme.grant_eligibility_criteria;
DROP POLICY IF EXISTS tenant_isolation ON scheme.grant_eligibility_criteria;
CREATE POLICY tenant_isolation_policy ON scheme.grant_eligibility_criteria
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- scheme.grant_schemes
ALTER TABLE scheme.grant_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.grant_schemes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON scheme.grant_schemes;
DROP POLICY IF EXISTS tenant_isolation ON scheme.grant_schemes;
CREATE POLICY tenant_isolation_policy ON scheme.grant_schemes
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- utilisation.grant_audit_paras
ALTER TABLE utilisation.grant_audit_paras ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_audit_paras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON utilisation.grant_audit_paras;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_audit_paras;
CREATE POLICY tenant_isolation_policy ON utilisation.grant_audit_paras
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- utilisation.grant_compliance_reports
ALTER TABLE utilisation.grant_compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_compliance_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON utilisation.grant_compliance_reports;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_compliance_reports;
CREATE POLICY tenant_isolation_policy ON utilisation.grant_compliance_reports
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- utilisation.grant_uc_statements
ALTER TABLE utilisation.grant_uc_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_uc_statements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON utilisation.grant_uc_statements;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_uc_statements;
CREATE POLICY tenant_isolation_policy ON utilisation.grant_uc_statements
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- utilisation.grant_uc_validations
ALTER TABLE utilisation.grant_uc_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_uc_validations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON utilisation.grant_uc_validations;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_uc_validations;
CREATE POLICY tenant_isolation_policy ON utilisation.grant_uc_validations
  USING (tenant_id = scheme.current_tenant_id())
  WITH CHECK (tenant_id = scheme.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = scheme.current_tenant_id())
      WITH CHECK (tenant_id = scheme.current_tenant_id())';
  END IF;
END $$;
