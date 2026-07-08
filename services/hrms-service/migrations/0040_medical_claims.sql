-- 0040_medical_claims.sql
-- Medical reimbursement / advance claims table.
-- Additive + idempotent. Money in paise (bigint).
--
-- Rollback: DROP TABLE IF EXISTS medical.hrms_medical_claims; DROP SCHEMA IF EXISTS medical;

CREATE SCHEMA IF NOT EXISTS medical;

CREATE TABLE IF NOT EXISTS medical.hrms_medical_claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  employee_id           uuid NOT NULL,
  claim_type            varchar(32) NOT NULL,
  amount_minor          bigint NOT NULL,
  approved_amount_minor bigint,
  hospital_name         varchar(256) NOT NULL,
  hospital_id           uuid,
  diagnosis             text NOT NULL,
  dependant_name        varchar(128),
  dependant_relation    varchar(32),
  documents             jsonb NOT NULL DEFAULT '[]'::jsonb,
  remarks               text,
  status                varchar(24) NOT NULL DEFAULT 'pending',
  approved_by           uuid,
  approved_at           timestamptz,
  rejection_reason      text,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  CONSTRAINT hrms_medical_claims_type_check
    CHECK (claim_type IN ('indoor','outdoor','reimbursement','advance')),
  CONSTRAINT hrms_medical_claims_status_check
    CHECK (status IN ('pending','approved','rejected','settled')),
  CONSTRAINT hrms_medical_claims_relation_check
    CHECK (dependant_relation IS NULL OR dependant_relation IN ('self','spouse','child','parent')),
  CONSTRAINT hrms_medical_claims_amount_positive
    CHECK (amount_minor > 0)
);

-- RLS
ALTER TABLE medical.hrms_medical_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical.hrms_medical_claims FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hrms_medical_claims_tenant_isolation ON medical.hrms_medical_claims;
CREATE POLICY hrms_medical_claims_tenant_isolation ON medical.hrms_medical_claims
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Indexes
CREATE INDEX IF NOT EXISTS hrms_medical_claims_emp_idx
  ON medical.hrms_medical_claims (tenant_id, employee_id);

CREATE INDEX IF NOT EXISTS hrms_medical_claims_status_idx
  ON medical.hrms_medical_claims (tenant_id, status);
