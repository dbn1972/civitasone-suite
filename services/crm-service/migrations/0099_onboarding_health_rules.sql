-- Purpose: Onboarding health metric framework (G19).
--   Configurable rule-based health checks that evaluate whether onboarding
--   milestones are hit within expected timeframes.
-- Rollback: DROP TABLE crm.onboarding_health_scores; DROP TABLE crm.onboarding_health_rules;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.onboarding_health_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  rule_key            varchar(64) NOT NULL,
  milestone_event     varchar(64) NOT NULL,
  expected_within_days int NOT NULL CHECK (expected_within_days > 0),
  weight              int NOT NULL DEFAULT 50 CHECK (weight >= 0 AND weight <= 100),
  active              boolean NOT NULL DEFAULT true,
  version             int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  CONSTRAINT uq_health_rule_tenant_key UNIQUE (tenant_id, rule_key)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_rules_tenant
  ON crm.onboarding_health_rules (tenant_id) WHERE active = true;

CREATE TABLE IF NOT EXISTS crm.onboarding_health_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  case_id         uuid NOT NULL REFERENCES crm.onboarding_cases(id),
  score           int NOT NULL CHECK (score >= 0 AND score <= 100),
  milestones_hit  jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_health_score_tenant_case UNIQUE (tenant_id, case_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_scores_tenant
  ON crm.onboarding_health_scores (tenant_id);
