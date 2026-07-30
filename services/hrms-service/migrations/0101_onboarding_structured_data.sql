-- 0101_onboarding_structured_data.sql
-- Sprint 3: Onboarding + Structured Data (T18–T24).
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC (lifecycle schema).
--
-- Rollback: DROP TABLE IF EXISTS lifecycle.hrms_bgv_checks, lifecycle.hrms_onboarding_tasks,
--   lifecycle.hrms_buddy_assignments, lifecycle.hrms_mandatory_doc_configs,
--   lifecycle.hrms_property_returns, lifecycle.hrms_employee_education,
--   lifecycle.hrms_employee_employment_history, lifecycle.hrms_policy_acknowledgements;

SET lock_timeout = '5s';

-- T18: BGV component tracking
CREATE TABLE IF NOT EXISTS lifecycle.hrms_bgv_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL,
  check_type    varchar(32) NOT NULL, provider varchar(64),
  status        varchar(16) NOT NULL DEFAULT 'pending',
  result        text, initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz, created_by uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_bgv_status_check CHECK (status IN ('pending','in_progress','passed','failed','inconclusive'))
);
CREATE INDEX IF NOT EXISTS hrms_bgv_emp_idx ON lifecycle.hrms_bgv_checks (tenant_id, employee_id);

-- T19: 30/60/90-day onboarding tasks
CREATE TABLE IF NOT EXISTS lifecycle.hrms_onboarding_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL,
  title         varchar(200) NOT NULL, due_by_day integer NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'pending',
  completed_at  timestamptz, assigned_to uuid,
  created_at    timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_onboard_status_check CHECK (status IN ('pending','completed','overdue','waived'))
);
CREATE INDEX IF NOT EXISTS hrms_onboard_emp_idx ON lifecycle.hrms_onboarding_tasks (tenant_id, employee_id);

-- T20: buddy/mentor assignment
CREATE TABLE IF NOT EXISTS lifecycle.hrms_buddy_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL, buddy_id uuid NOT NULL,
  role          varchar(16) NOT NULL DEFAULT 'buddy',
  assigned_at   timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  created_by    uuid NOT NULL,
  CONSTRAINT hrms_buddy_role_check CHECK (role IN ('buddy','mentor'))
);
CREATE INDEX IF NOT EXISTS hrms_buddy_emp_idx ON lifecycle.hrms_buddy_assignments (tenant_id, employee_id);

-- T21: mandatory document config per employee type
CREATE TABLE IF NOT EXISTS lifecycle.hrms_mandatory_doc_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  employee_type varchar(32) NOT NULL, doc_type varchar(64) NOT NULL,
  required      boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hrms_mandoc_uq ON lifecycle.hrms_mandatory_doc_configs (tenant_id, employee_type, doc_type);

-- T22: property-return filing tracking
CREATE TABLE IF NOT EXISTS lifecycle.hrms_property_returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL,
  item_description text NOT NULL,
  return_status varchar(16) NOT NULL DEFAULT 'pending',
  returned_at   timestamptz, verified_by uuid,
  created_at    timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_propret_status_check CHECK (return_status IN ('pending','returned','waived','lost'))
);
CREATE INDEX IF NOT EXISTS hrms_propret_emp_idx ON lifecycle.hrms_property_returns (tenant_id, employee_id);

-- T23: structured employee education + employment history
CREATE TABLE IF NOT EXISTS lifecycle.hrms_employee_education (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL,
  qualification varchar(120) NOT NULL, subject varchar(200), institution varchar(200),
  year_of_passing integer, verified boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS hrms_empedu_emp_idx ON lifecycle.hrms_employee_education (tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS lifecycle.hrms_employee_employment_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL,
  employer      varchar(200) NOT NULL, role_title varchar(200),
  from_date     date, to_date date,
  created_at    timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS hrms_emphis_emp_idx ON lifecycle.hrms_employee_employment_history (tenant_id, employee_id);

-- T24: policy acknowledgement tracking
CREATE TABLE IF NOT EXISTS lifecycle.hrms_policy_acknowledgements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL, employee_id uuid NOT NULL,
  policy_name   varchar(200) NOT NULL, policy_version varchar(24),
  acknowledged_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS hrms_polack_emp_idx ON lifecycle.hrms_policy_acknowledgements (tenant_id, employee_id);

-- RLS for all tables (batch)
DO $$ DECLARE t text; BEGIN
  FOR t IN VALUES ('hrms_bgv_checks'),('hrms_onboarding_tasks'),('hrms_buddy_assignments'),
    ('hrms_mandatory_doc_configs'),('hrms_property_returns'),('hrms_employee_education'),
    ('hrms_employee_employment_history'),('hrms_policy_acknowledgements')
  LOOP
    EXECUTE format('ALTER TABLE lifecycle.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE lifecycle.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON lifecycle.%I', t, t);
    EXECUTE format('CREATE POLICY %I_tenant ON lifecycle.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON lifecycle.%I TO hrms_svc', t);
  END LOOP;
END $$;
