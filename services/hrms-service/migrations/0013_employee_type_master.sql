-- hrms-service: Custom Employee Type Master.
-- Additive, idempotent. Allows tenants to define their own employee categories.

CREATE TABLE IF NOT EXISTS employee.hrms_employee_types (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  code                    varchar(24) NOT NULL,
  name                    varchar(120) NOT NULL,
  description             varchar(500),
  eligible_for_leave      boolean NOT NULL DEFAULT true,
  eligible_for_payroll    boolean NOT NULL DEFAULT true,
  eligible_for_appraisal  boolean NOT NULL DEFAULT true,
  default_probation_months integer NOT NULL DEFAULT 0,
  max_contract_months     integer,
  pay_mode                varchar(16) NOT NULL DEFAULT 'monthly',
  is_active               boolean NOT NULL DEFAULT true,
  sort_order              integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_employee_types_tenant ON employee.hrms_employee_types(tenant_id, is_active);
