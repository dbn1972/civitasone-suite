-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: grant-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- application.grant_scores.application_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_scores_application_id
  ON application.grant_scores (application_id);

-- beneficiary.grant_aadhaar_links.beneficiary_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_aadhaar_links_beneficiary_id
  ON beneficiary.grant_aadhaar_links (beneficiary_id);

-- disbursement.grant_installments.milestone_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_installments_milestone_id
  ON disbursement.grant_installments (milestone_id);

-- disbursement.grant_pfms_records.disbursement_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_pfms_records_disbursement_id
  ON disbursement.grant_pfms_records (disbursement_id);

-- utilisation.grant_compliance_reports.application_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_compliance_reports_application_id
  ON utilisation.grant_compliance_reports (application_id);

-- utilisation.grant_audit_paras.application_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_audit_paras_application_id
  ON utilisation.grant_audit_paras (application_id);

-- utilisation.grant_uc_validations.uc_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_uc_validations_uc_id
  ON utilisation.grant_uc_validations (uc_id);
