-- 0254_hrms_medical_insurance.sql
--
-- HRMS medical insurance: GET /v1/hrms/medical/insurance has selected from
-- employee.medical_insurance since the medical module landed, but no
-- migration ever created that table and nothing wrote to it, so the route
-- 500'd on every call. This creates it, plus the HR write path
-- (PUT/DELETE /v1/hrms/medical/insurance/:employeeId -> CQRS consumer).
--
-- One CURRENT record per employee (unique tenant_id + employee_id); there is
-- no policy history in this module yet (a replaced policy is overwritten,
-- every change is recorded in the audit outbox without the card number).
--
-- PII: card_number and scheme_id hold the hrms AES-256-GCM envelope
-- ("enc:v2:<keyid>:..." -- shared/pii-crypto.ts). They are encrypted in the
-- route BEFORE the command is published, so plaintext never reaches the
-- queue, the outbox or this table. Hence plain `text`, no length limit.
--
-- scheme_type vocabulary: cghs | state_scheme | group_mediclaim | esic | other
-- (lowercase codes, same style as hrms_medical_claims.claim_type).
--
-- Additive + idempotent (IF NOT EXISTS / DROP ... IF EXISTS / guarded DO).
--
-- Rollback: DROP TABLE IF EXISTS employee.medical_insurance;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.medical_insurance (
  id                  uuid        PRIMARY KEY,
  tenant_id           uuid        NOT NULL,
  employee_id         uuid        NOT NULL,
  scheme_type         varchar(24) NOT NULL,
  scheme_id           text,
  card_number         text        NOT NULL,
  validity_from       date        NOT NULL,
  validity_to         date,
  tier                varchar(64),
  dependants          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  annual_limit_minor  bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1,
  CONSTRAINT medical_insurance_scheme_type_check
    CHECK (scheme_type IN ('cghs', 'state_scheme', 'group_mediclaim', 'esic', 'other')),
  CONSTRAINT medical_insurance_validity_check
    CHECK (validity_to IS NULL OR validity_from <= validity_to),
  CONSTRAINT medical_insurance_annual_limit_check
    CHECK (annual_limit_minor IS NULL OR annual_limit_minor >= 0),
  CONSTRAINT medical_insurance_dependants_array_check
    CHECK (jsonb_typeof(dependants) = 'array')
);

-- Same FK shape as 0028_fk_constraints.sql's per-employee sub-records.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_medical_insurance_employee'
      AND conrelid = 'employee.medical_insurance'::regclass
  ) THEN
    ALTER TABLE employee.medical_insurance
      ADD CONSTRAINT fk_medical_insurance_employee
      FOREIGN KEY (employee_id) REFERENCES employee.hrms_employees(id) ON DELETE CASCADE;
  END IF;
END $$;

-- One current record per employee; also the (tenant_id, employee_id) lookup index.
CREATE UNIQUE INDEX IF NOT EXISTS medical_insurance_tenant_employee_uniq
  ON employee.medical_insurance (tenant_id, employee_id);

ALTER TABLE employee.medical_insurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.medical_insurance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.medical_insurance;
CREATE POLICY tenant_isolation_policy ON employee.medical_insurance
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON employee.medical_insurance TO hrms_svc;
  END IF;
END $$;
