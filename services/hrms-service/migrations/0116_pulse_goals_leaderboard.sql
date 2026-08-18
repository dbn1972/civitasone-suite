-- 0016: Pulse Surveys, Goals/OKR, Gamified Leaderboard
-- Closes the final gap to world-class employee app

-- ─── Pulse Surveys ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.pulse_surveys (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  question TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'engagement', -- engagement, culture, workload, growth, wellbeing
  is_active BOOLEAN NOT NULL DEFAULT true,
  anonymous BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_pulse_surveys_tenant ON hrms.pulse_surveys (tenant_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS hrms.pulse_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  survey_id UUID NOT NULL REFERENCES hrms.pulse_surveys(id),
  respondent_id UUID NOT NULL,
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5), -- 1-5 scale
  comment TEXT,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survey_id, respondent_id) -- one response per person per survey
);
CREATE INDEX idx_pulse_responses_survey ON hrms.pulse_responses (survey_id);

-- ─── Goals / OKR ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.goals (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'individual', -- individual, team, organization
  key_results JSONB NOT NULL DEFAULT '[]', -- [{title, targetValue, currentValue, unit}]
  progress INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  due_date DATE,
  period TEXT, -- e.g. "Q1-2026", "FY2026"
  parent_goal_id UUID REFERENCES hrms.goals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_goals_tenant_employee ON hrms.goals (tenant_id, employee_id, status);

CREATE TABLE IF NOT EXISTS hrms.goal_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES hrms.goals(id),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  progress INT NOT NULL CHECK (progress BETWEEN 0 AND 100),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_goal_checkins_goal ON hrms.goal_checkins (goal_id, created_at DESC);

-- ─── Gamified Leaderboard ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hrms.leaderboard_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  points INT NOT NULL DEFAULT 0,
  reason TEXT NOT NULL, -- kudos_received, goal_completed, survey_responded, attendance_streak, etc.
  source_id UUID, -- ID of kudos/goal/survey that triggered points
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leaderboard_tenant ON hrms.leaderboard_points (tenant_id, employee_id);
CREATE INDEX idx_leaderboard_month ON hrms.leaderboard_points (tenant_id, awarded_at DESC);

-- Materialized view for fast leaderboard queries (refresh periodically via scheduler)
CREATE TABLE IF NOT EXISTS hrms.leaderboard_totals (
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  employee_name TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  total_points INT NOT NULL DEFAULT 0,
  month_points INT NOT NULL DEFAULT 0,
  rank INT NOT NULL DEFAULT 0,
  badges JSONB NOT NULL DEFAULT '[]', -- earned badge list
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, employee_id)
);
