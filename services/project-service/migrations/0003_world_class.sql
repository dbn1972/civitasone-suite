CREATE TABLE IF NOT EXISTS project.milestone_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, milestone_id UUID NOT NULL,
  file_key VARCHAR(1024) NOT NULL, file_name VARCHAR(512),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), uploaded_by UUID NOT NULL
);
