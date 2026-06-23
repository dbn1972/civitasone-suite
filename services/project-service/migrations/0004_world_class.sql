-- Projects: Scheme dashboard aggregate table
CREATE TABLE IF NOT EXISTS project.project_scheme_dashboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  scheme_id UUID NOT NULL,
  total_outlay_minor BIGINT NOT NULL DEFAULT 0,
  expenditure_minor BIGINT NOT NULL DEFAULT 0,
  completion_pct INT NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
