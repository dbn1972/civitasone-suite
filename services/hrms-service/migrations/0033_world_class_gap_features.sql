-- 0033: World-class gap features — compensation planning, LMS, skills matrix,
-- succession planning, engagement surveys, onboarding, 360 feedback, benefits.
-- Additive + idempotent (IF NOT EXISTS).

-- Gap 1: Compensation Planning
CREATE TABLE IF NOT EXISTS employee.compensation_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, name VARCHAR(200) NOT NULL,
  fy CHAR(7) NOT NULL, budget_minor BIGINT NOT NULL DEFAULT 0,
  guidelines JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','modelling','approved','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL,
  UNIQUE(tenant_id, name, fy)
);
CREATE TABLE IF NOT EXISTS employee.compensation_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, plan_id UUID NOT NULL, employee_id UUID NOT NULL,
  current_ctc_minor BIGINT NOT NULL DEFAULT 0,
  recommended_increment_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  recommended_new_ctc_minor BIGINT NOT NULL DEFAULT 0,
  compa_ratio NUMERIC(5,2), performance_rating VARCHAR(8),
  status VARCHAR(16) NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gap 2: LMS
CREATE TABLE IF NOT EXISTS training.lms_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, code VARCHAR(32) NOT NULL, name VARCHAR(200) NOT NULL,
  description TEXT, duration_hours INT NOT NULL DEFAULT 1,
  skills_gained JSONB NOT NULL DEFAULT '[]',
  mandatory_for_roles JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL, UNIQUE(tenant_id, code)
);
CREATE TABLE IF NOT EXISTS training.lms_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, course_id UUID NOT NULL, employee_id UUID NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
  score NUMERIC(5,2), status VARCHAR(16) NOT NULL DEFAULT 'enrolled'
    CHECK (status IN ('enrolled','in_progress','completed','failed','expired')),
  UNIQUE(tenant_id, course_id, employee_id)
);

-- Gap 3: Skills & Competency Matrix
CREATE TABLE IF NOT EXISTS employee.competencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'technical',
  proficiency_levels JSONB NOT NULL DEFAULT '["beginner","intermediate","advanced","expert"]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL,
  UNIQUE(tenant_id, name)
);
CREATE TABLE IF NOT EXISTS employee.role_competency_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, role_ref VARCHAR(128) NOT NULL,
  competency_id UUID NOT NULL, required_level VARCHAR(32) NOT NULL DEFAULT 'intermediate',
  UNIQUE(tenant_id, role_ref, competency_id)
);
CREATE TABLE IF NOT EXISTS employee.skill_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, employee_id UUID NOT NULL, competency_id UUID NOT NULL,
  assessed_level VARCHAR(32) NOT NULL, assessed_by UUID NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes VARCHAR(512)
);
CREATE INDEX IF NOT EXISTS idx_skill_assessments_emp ON employee.skill_assessments (tenant_id, employee_id);

-- Gap 4: Succession Planning
CREATE TABLE IF NOT EXISTS employee.succession_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, role_ref VARCHAR(128) NOT NULL,
  is_critical BOOLEAN NOT NULL DEFAULT TRUE,
  department_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL,
  UNIQUE(tenant_id, role_ref)
);
CREATE TABLE IF NOT EXISTS employee.succession_nominees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, plan_id UUID NOT NULL, employee_id UUID NOT NULL,
  readiness VARCHAR(16) NOT NULL DEFAULT '1yr' CHECK (readiness IN ('now','1yr','2yr','3yr')),
  development_plan TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, plan_id, employee_id)
);

-- Gap 5: Engagement Surveys
CREATE TABLE IF NOT EXISTS employee.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, title VARCHAR(200) NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]',
  is_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  audience JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL
);
CREATE TABLE IF NOT EXISTS employee.survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, survey_id UUID NOT NULL,
  respondent_token UUID NOT NULL DEFAULT gen_random_uuid(),
  answers JSONB NOT NULL DEFAULT '[]',
  enps_score INT, submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON employee.survey_responses (tenant_id, survey_id);

-- Gap 6: Onboarding
CREATE TABLE IF NOT EXISTS employee.onboarding_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, name VARCHAR(128) NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL, UNIQUE(tenant_id, name)
);
CREATE TABLE IF NOT EXISTS employee.onboarding_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, template_id UUID NOT NULL, employee_id UUID NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]', completion_pct INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_instances_emp ON employee.onboarding_instances (tenant_id, employee_id);

-- Gap 7: 360° Feedback
CREATE TABLE IF NOT EXISTS employee.feedback_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, name VARCHAR(200) NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]',
  rater_groups JSONB NOT NULL DEFAULT '["self","manager","peer","report"]',
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL
);
CREATE TABLE IF NOT EXISTS employee.feedback_nominations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, cycle_id UUID NOT NULL, employee_id UUID NOT NULL,
  rater_id UUID NOT NULL, rater_group VARCHAR(32) NOT NULL,
  UNIQUE(tenant_id, cycle_id, employee_id, rater_id)
);
CREATE TABLE IF NOT EXISTS employee.feedback_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, cycle_id UUID NOT NULL, employee_id UUID NOT NULL,
  rater_group VARCHAR(32) NOT NULL, scores JSONB NOT NULL DEFAULT '{}',
  comments TEXT, submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_cycle ON employee.feedback_responses (tenant_id, cycle_id, employee_id);

-- Gap 8: Benefits Administration
CREATE TABLE IF NOT EXISTS employee.benefit_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, name VARCHAR(128) NOT NULL, fy CHAR(7) NOT NULL,
  flex_budget_minor BIGINT NOT NULL DEFAULT 0,
  components JSONB NOT NULL DEFAULT '[]',
  eligibility JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL, UNIQUE(tenant_id, name, fy)
);
CREATE TABLE IF NOT EXISTS employee.benefit_elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, plan_id UUID NOT NULL, employee_id UUID NOT NULL,
  fy CHAR(7) NOT NULL, elections JSONB NOT NULL DEFAULT '[]',
  total_elected_minor BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'submitted', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, plan_id, employee_id, fy)
);
