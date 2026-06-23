CREATE TABLE IF NOT EXISTS payroll.payroll_tax_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  fy CHAR(7) NOT NULL,
  regime VARCHAR(4) NOT NULL DEFAULT 'new' CHECK (regime IN ('old', 'new')),
  section_80c BIGINT NOT NULL DEFAULT 0,
  section_80d BIGINT NOT NULL DEFAULT 0,
  hra_claimed BIGINT NOT NULL DEFAULT 0,
  other_deductions BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  UNIQUE(tenant_id, employee_id, fy)
);
