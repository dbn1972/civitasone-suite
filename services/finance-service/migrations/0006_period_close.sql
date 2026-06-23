CREATE SCHEMA IF NOT EXISTS gl;

CREATE TABLE IF NOT EXISTS gl.finance_period_close (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  fiscal_year VARCHAR(9) NOT NULL,
  period CHAR(7) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'open',
  closed_by UUID,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, fiscal_year, period)
);
