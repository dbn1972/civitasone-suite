-- Orchestrator module schema
CREATE SCHEMA IF NOT EXISTS orchestrator;

CREATE TABLE IF NOT EXISTS orchestrator.wizard_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(128) NOT NULL,
  description text,
  status varchar(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orchestrator.step_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  wizard_id uuid NOT NULL REFERENCES orchestrator.wizard_definitions(id),
  step_key varchar(64) NOT NULL,
  title varchar(128) NOT NULL,
  description text,
  is_required boolean NOT NULL DEFAULT true,
  depends_on text[] NOT NULL DEFAULT '{}',
  handler_type varchar(64) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (wizard_id, step_key)
);

CREATE TABLE IF NOT EXISTS orchestrator.step_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  wizard_id uuid NOT NULL REFERENCES orchestrator.wizard_definitions(id),
  step_key varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','blocked','ready','in_progress','completed','failed','skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (wizard_id, step_key, tenant_id)
);

-- RLS
ALTER TABLE orchestrator.wizard_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_wizard_definitions ON orchestrator.wizard_definitions USING (tenant_id = current_setting('app.tenant_id')::uuid);
ALTER TABLE orchestrator.step_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_step_definitions ON orchestrator.step_definitions USING (tenant_id = current_setting('app.tenant_id')::uuid);
ALTER TABLE orchestrator.step_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_step_executions ON orchestrator.step_executions USING (tenant_id = current_setting('app.tenant_id')::uuid);
