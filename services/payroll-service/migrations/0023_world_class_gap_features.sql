-- 0023: World-class gap features — simulation, pay groups, corrections,
-- off-cycle payments, flex benefits, costing, tax optimization.
-- Additive + idempotent (IF NOT EXISTS).

-- Gap 1: Payroll Simulation
CREATE TABLE IF NOT EXISTS payroll.simulation_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  run_id          UUID NOT NULL,
  employee_id     UUID NOT NULL,
  result_json     JSONB NOT NULL DEFAULT '{}',
  previous_net_minor BIGINT NOT NULL DEFAULT 0,
  simulated_net_minor BIGINT NOT NULL DEFAULT 0,
  variance_pct    NUMERIC(6,2) NOT NULL DEFAULT 0,
  flagged         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_simulation_results_run
  ON payroll.simulation_results (tenant_id, run_id);

-- Gap 2: Pay Groups
CREATE TABLE IF NOT EXISTS payroll.pay_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            VARCHAR(128) NOT NULL,
  frequency       VARCHAR(16) NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('monthly','bi_weekly','weekly')),
  pay_day_of_month INT NOT NULL DEFAULT 28,
  timezone        VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  status          VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  UNIQUE(tenant_id, name)
);

-- Gap 3: Salary Corrections (extends existing arrears pattern)
CREATE TABLE IF NOT EXISTS payroll.salary_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  employee_id     UUID NOT NULL,
  component       VARCHAR(32) NOT NULL,
  effective_from  DATE NOT NULL,
  old_value_minor BIGINT NOT NULL,
  new_value_minor BIGINT NOT NULL,
  arrears_minor   BIGINT NOT NULL DEFAULT 0,
  affected_periods INT NOT NULL DEFAULT 0,
  reason          VARCHAR(512),
  applied_in_run_id UUID,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','applied','rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_salary_corrections_employee
  ON payroll.salary_corrections (tenant_id, employee_id, status);

-- Gap 5: Flex Benefit Plans
CREATE TABLE IF NOT EXISTS payroll.flex_benefit_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            VARCHAR(128) NOT NULL,
  fy              CHAR(7) NOT NULL,
  total_budget_minor BIGINT NOT NULL,
  components      JSONB NOT NULL DEFAULT '[]',
  status          VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  UNIQUE(tenant_id, name, fy)
);

CREATE TABLE IF NOT EXISTS payroll.flex_benefit_elections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  employee_id     UUID NOT NULL,
  plan_id         UUID NOT NULL,
  fy              CHAR(7) NOT NULL,
  elections       JSONB NOT NULL DEFAULT '[]',
  total_elected_minor BIGINT NOT NULL DEFAULT 0,
  status          VARCHAR(16) NOT NULL DEFAULT 'submitted',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  UNIQUE(tenant_id, employee_id, plan_id, fy)
);

-- Gap 6: Costing Rules
CREATE TABLE IF NOT EXISTS payroll.costing_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  employee_group  VARCHAR(64) NOT NULL,
  cost_center_id  UUID NOT NULL,
  split_pct       NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  status          VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  UNIQUE(tenant_id, employee_group, cost_center_id)
);

-- Gap 8: Off-Cycle Payments
CREATE TABLE IF NOT EXISTS payroll.off_cycle_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  run_type        VARCHAR(16) NOT NULL DEFAULT 'bonus'
    CHECK (run_type IN ('bonus','incentive','adhoc')),
  description     VARCHAR(256),
  period          CHAR(7) NOT NULL,
  total_amount_minor BIGINT NOT NULL DEFAULT 0,
  total_tax_minor BIGINT NOT NULL DEFAULT 0,
  total_net_minor BIGINT NOT NULL DEFAULT 0,
  status          VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','processed','paid','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll.off_cycle_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  off_cycle_run_id UUID NOT NULL,
  employee_id     UUID NOT NULL,
  amount_minor    BIGINT NOT NULL,
  tax_minor       BIGINT NOT NULL DEFAULT 0,
  net_minor       BIGINT NOT NULL DEFAULT 0,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_off_cycle_items_run
  ON payroll.off_cycle_items (tenant_id, off_cycle_run_id);
