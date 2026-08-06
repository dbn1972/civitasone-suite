-- Purpose: Add account health score tables for G10 — configurable composite health scoring.
-- Rollback: DROP TABLE IF EXISTS crm.account_health_scores; DROP TABLE IF EXISTS crm.health_score_configs;
-- Affected services: crm-service

SET lock_timeout = '5s';

-- Per-tenant health score signal configuration
CREATE TABLE IF NOT EXISTS crm.health_score_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  signal_name varchar(100) NOT NULL,
  weight      integer NOT NULL CHECK (weight >= 0 AND weight <= 100),
  decay_days  integer NOT NULL DEFAULT 90 CHECK (decay_days > 0),
  source      varchar(20) NOT NULL CHECK (source IN ('activity', 'ticket', 'deal', 'payment')),
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL,
  updated_by  uuid,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, signal_name)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_score_configs_tenant
  ON crm.health_score_configs (tenant_id);

-- Computed account health scores
CREATE TABLE IF NOT EXISTS crm.account_health_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  account_id  uuid NOT NULL REFERENCES crm.accounts(id),
  score       integer NOT NULL CHECK (score >= 0 AND score <= 100),
  signals     jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_health_scores_tenant
  ON crm.account_health_scores (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_health_scores_account
  ON crm.account_health_scores (account_id);
