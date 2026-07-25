SET lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS workflow.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  case_number varchar(32) NOT NULL, title varchar(256) NOT NULL,
  case_type varchar(64) NOT NULL, status varchar(24) NOT NULL DEFAULT 'open',
  priority varchar(16) NOT NULL DEFAULT 'normal',
  source_service varchar(64) NOT NULL, source_ref_id uuid NOT NULL,
  assignee_id uuid, parent_case_id uuid, merged_into_case_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, created_by uuid NOT NULL, version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cases_tenant ON workflow.cases (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_parent ON workflow.cases (parent_case_id) WHERE parent_case_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow.case_deviations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  case_id uuid NOT NULL, type varchar(32) NOT NULL,
  description text NOT NULL, severity varchar(16) NOT NULL DEFAULT 'medium',
  status varchar(16) NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_deviations_case ON workflow.case_deviations (case_id);
