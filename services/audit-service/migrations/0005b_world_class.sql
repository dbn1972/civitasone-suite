-- Audit: CAG Para tracking for audit responses
CREATE TABLE IF NOT EXISTS para.audit_cag_paras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  para_no VARCHAR(32) NOT NULL,
  subject TEXT NOT NULL,
  cag_report_year VARCHAR(7) NOT NULL,
  department VARCHAR(128),
  amount_minor BIGINT DEFAULT 0,
  response_status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (response_status IN ('pending','draft_reply','submitted','accepted','disputed')),
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
