-- Purpose: Create the `ml` schema with core tables for the ML service — model registry,
--   predictions fact table, feature vector store, training run history, and A/B experiments.
-- Rollback:
--   DROP SCHEMA ml CASCADE;
--   DROP SCHEMA _outbox CASCADE;
--   DROP SCHEMA _inbox CASCADE;
-- Affected services: ml-service
-- NOTE: This migration is additive and idempotent (IF NOT EXISTS on all objects).

SET lock_timeout = '5s';

-- ============================================================================
-- Schema creation
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS ml;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ============================================================================
-- Helper function for RLS tenant isolation
-- ============================================================================
CREATE OR REPLACE FUNCTION ml.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ============================================================================
-- ml_models: Model registry metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS ml.ml_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  domain TEXT NOT NULL,
  version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  s3_key TEXT NOT NULL,
  trained_at TIMESTAMPTZ NOT NULL,
  record_count INT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  feature_list TEXT[] NOT NULL DEFAULT '{}',
  model_card JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version_lock INT NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, domain, version)
);

-- CHECK constraints for bounded status/domain columns
DO $$ BEGIN
  ALTER TABLE ml.ml_models
    ADD CONSTRAINT ml_models_status_check
    CHECK (status IN ('training', 'candidate', 'active', 'deactivated', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ml.ml_models
    ADD CONSTRAINT ml_models_domain_check
    CHECK (domain IN ('leads', 'tickets', 'inventory', 'subscriptions', 'tasks', 'transactions'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ml.ml_models VALIDATE CONSTRAINT ml_models_status_check;
ALTER TABLE ml.ml_models VALIDATE CONSTRAINT ml_models_domain_check;

-- ============================================================================
-- ml_predictions: Prediction fact table (audit + evaluation + feedback)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ml.ml_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  domain TEXT NOT NULL,
  entity_id UUID NOT NULL,
  model_id UUID REFERENCES ml.ml_models(id),
  experiment_id TEXT,
  prediction NUMERIC(5,4),
  confidence NUMERIC(5,4) NOT NULL,
  factors JSONB NOT NULL DEFAULT '[]',
  is_fallback BOOLEAN NOT NULL DEFAULT false,
  fallback_reason TEXT,
  actual_outcome TEXT,
  user_decision TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ml_feature_vectors: Materialized feature vectors per entity
-- ============================================================================
CREATE TABLE IF NOT EXISTS ml.ml_feature_vectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  domain TEXT NOT NULL,
  entity_id UUID NOT NULL,
  features JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, domain, entity_id)
);

-- ============================================================================
-- ml_training_runs: Training job history
-- ============================================================================
CREATE TABLE IF NOT EXISTS ml.ml_training_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  record_count INT NOT NULL DEFAULT 0,
  metrics JSONB,
  error_message TEXT,
  model_id UUID REFERENCES ml.ml_models(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE ml.ml_training_runs
    ADD CONSTRAINT ml_training_runs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ml.ml_training_runs VALIDATE CONSTRAINT ml_training_runs_status_check;

-- ============================================================================
-- ml_experiments: A/B experiment configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS ml.ml_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  challenger_model_id UUID NOT NULL REFERENCES ml.ml_models(id),
  current_model_id UUID NOT NULL REFERENCES ml.ml_models(id),
  split_pct INT NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE ml.ml_experiments
    ADD CONSTRAINT ml_experiments_status_check
    CHECK (status IN ('active', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ml.ml_experiments VALIDATE CONSTRAINT ml_experiments_status_check;

-- ============================================================================
-- Indexes (CONCURRENTLY for non-blocking creation)
-- ============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_models_tenant_domain_active
  ON ml.ml_models(tenant_id, domain) WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_predictions_tenant_domain_entity
  ON ml.ml_predictions(tenant_id, domain, entity_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_predictions_created_at
  ON ml.ml_predictions(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_feature_vectors_lookup
  ON ml.ml_feature_vectors(tenant_id, domain, entity_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_training_runs_tenant_domain
  ON ml.ml_training_runs(tenant_id, domain, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ml_experiments_tenant_domain_active
  ON ml.ml_experiments(tenant_id, domain) WHERE status = 'active';

-- ============================================================================
-- Row-Level Security (RLS) — tenant isolation
-- ============================================================================

-- ml.ml_models
ALTER TABLE ml.ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.ml_models FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ml.ml_models;
CREATE POLICY tenant_isolation_policy ON ml.ml_models
  USING (tenant_id = ml.current_tenant_id())
  WITH CHECK (tenant_id = ml.current_tenant_id());

-- ml.ml_predictions
ALTER TABLE ml.ml_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.ml_predictions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ml.ml_predictions;
CREATE POLICY tenant_isolation_policy ON ml.ml_predictions
  USING (tenant_id = ml.current_tenant_id())
  WITH CHECK (tenant_id = ml.current_tenant_id());

-- ml.ml_feature_vectors
ALTER TABLE ml.ml_feature_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.ml_feature_vectors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ml.ml_feature_vectors;
CREATE POLICY tenant_isolation_policy ON ml.ml_feature_vectors
  USING (tenant_id = ml.current_tenant_id())
  WITH CHECK (tenant_id = ml.current_tenant_id());

-- ml.ml_training_runs
ALTER TABLE ml.ml_training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.ml_training_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ml.ml_training_runs;
CREATE POLICY tenant_isolation_policy ON ml.ml_training_runs
  USING (tenant_id = ml.current_tenant_id())
  WITH CHECK (tenant_id = ml.current_tenant_id());

-- ml.ml_experiments
ALTER TABLE ml.ml_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.ml_experiments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ml.ml_experiments;
CREATE POLICY tenant_isolation_policy ON ml.ml_experiments
  USING (tenant_id = ml.current_tenant_id())
  WITH CHECK (tenant_id = ml.current_tenant_id());

-- ============================================================================
-- Outbox and Inbox (standard pattern)
-- ============================================================================
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          VARCHAR(128) NOT NULL,
  event_type     VARCHAR(128) NOT NULL,
  tenant_id      UUID NOT NULL,
  actor_id       UUID NOT NULL,
  correlation_id VARCHAR(64) NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
