-- grant-service RLS migration: tenant isolation backstop
-- Role: grant_svc on civitas_grant
-- Applied AFTER 0004_milestone_installment_link.sql

CREATE OR REPLACE FUNCTION scheme.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- scheme schema
ALTER TABLE scheme.grant_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.grant_schemes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheme.grant_schemes;
CREATE POLICY tenant_isolation ON scheme.grant_schemes USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE scheme.grant_eligibility_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme.grant_eligibility_criteria FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheme.grant_eligibility_criteria;
CREATE POLICY tenant_isolation ON scheme.grant_eligibility_criteria USING (tenant_id = scheme.current_tenant_id());

-- application schema
ALTER TABLE application.grant_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_applications;
CREATE POLICY tenant_isolation ON application.grant_applications USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE application.grant_app_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_app_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_app_documents;
CREATE POLICY tenant_isolation ON application.grant_app_documents USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE application.grant_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_scores;
CREATE POLICY tenant_isolation ON application.grant_scores USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE application.grant_sanction_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.grant_sanction_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application.grant_sanction_counters;
CREATE POLICY tenant_isolation ON application.grant_sanction_counters USING (tenant_id = scheme.current_tenant_id());

-- disbursement schema
ALTER TABLE disbursement.grant_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement.grant_installments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON disbursement.grant_installments;
CREATE POLICY tenant_isolation ON disbursement.grant_installments USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE disbursement.grant_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement.grant_disbursements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON disbursement.grant_disbursements;
CREATE POLICY tenant_isolation ON disbursement.grant_disbursements USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE disbursement.grant_pfms_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement.grant_pfms_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON disbursement.grant_pfms_records;
CREATE POLICY tenant_isolation ON disbursement.grant_pfms_records USING (tenant_id = scheme.current_tenant_id());

-- utilisation schema
ALTER TABLE utilisation.grant_uc_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_uc_statements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_uc_statements;
CREATE POLICY tenant_isolation ON utilisation.grant_uc_statements USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE utilisation.grant_compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_compliance_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_compliance_reports;
CREATE POLICY tenant_isolation ON utilisation.grant_compliance_reports USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE utilisation.grant_audit_paras ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_audit_paras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_audit_paras;
CREATE POLICY tenant_isolation ON utilisation.grant_audit_paras USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE utilisation.grant_uc_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisation.grant_uc_validations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON utilisation.grant_uc_validations;
CREATE POLICY tenant_isolation ON utilisation.grant_uc_validations USING (tenant_id = scheme.current_tenant_id());

-- beneficiary schema
ALTER TABLE beneficiary.grant_beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_beneficiaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON beneficiary.grant_beneficiaries;
CREATE POLICY tenant_isolation ON beneficiary.grant_beneficiaries USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE beneficiary.grant_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_bank_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON beneficiary.grant_bank_accounts;
CREATE POLICY tenant_isolation ON beneficiary.grant_bank_accounts USING (tenant_id = scheme.current_tenant_id());

ALTER TABLE beneficiary.grant_aadhaar_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary.grant_aadhaar_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON beneficiary.grant_aadhaar_links;
CREATE POLICY tenant_isolation ON beneficiary.grant_aadhaar_links USING (tenant_id = scheme.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = scheme.current_tenant_id());
