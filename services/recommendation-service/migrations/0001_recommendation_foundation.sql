-- Purpose: Recommendation Foundation — served recommendations (NBA), cross-sell matrix,
--          account health scores, and recommendation feedback.
-- Rollback: DROP SCHEMA recommendation CASCADE; (destructive — requires explicit approval)
-- Affected services: recommendation-service only
SET lock_timeout = '5s';

-- Schema
CREATE SCHEMA IF NOT EXISTS recommendation;

-- Service role grants.
--
-- The recommendation_svc login role is NOT created here. Service login roles
-- (and their passwords) are owned by infra/db/bootstrap/* — see
-- bootstrap_new_services.sql for the CREATE ROLE ... WITH LOGIN PASSWORD form.
-- A migration must never create a passwordless LOGIN role: depending on
-- pg_hba.conf that is a usable credential-free account, and it would not match
-- the DATABASE_URL the service actually connects with.
--
-- Grants are therefore guarded on the role already existing, so this migration
-- stays runnable where the role has not been provisioned yet (local dev / CI).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT USAGE ON SCHEMA recommendation TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA recommendation TO recommendation_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA recommendation
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recommendation_svc;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA recommendation TO recommendation_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA recommendation
      GRANT USAGE, SELECT ON SEQUENCES TO recommendation_svc;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Recommendations (Next Best Action served log)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendation.recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  profile_id          uuid NOT NULL,
  recommendation_type varchar(64) NOT NULL,
  product_id          uuid,
  channel             varchar(64),
  -- Confidence/relevance score in the 0.0000 – 1.0000 range.
  score               numeric(5,4) NOT NULL,
  -- served → accepted | rejected | expired (state machine in nba/domain.ts)
  status              varchar(24) NOT NULL DEFAULT 'served',
  served_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendations_tenant_id
  ON recommendation.recommendations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendations_tenant_profile
  ON recommendation.recommendations (tenant_id, profile_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendations_tenant_profile_served
  ON recommendation.recommendations (tenant_id, profile_id, served_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendations_tenant_status
  ON recommendation.recommendations (tenant_id, status);

-- RLS
ALTER TABLE recommendation.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.recommendations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recommendations_tenant_isolation ON recommendation.recommendations;
CREATE POLICY recommendations_tenant_isolation ON recommendation.recommendations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Cross-sell matrix (product-to-product recommendation rules)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendation.cross_sell_matrix (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  trigger_product_id     uuid NOT NULL,
  recommended_product_id uuid NOT NULL,
  segment                varchar(64),
  channel                varchar(64),
  priority               int NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_matrix_tenant_id
  ON recommendation.cross_sell_matrix (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_matrix_tenant_trigger
  ON recommendation.cross_sell_matrix (tenant_id, trigger_product_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_matrix_tenant_priority
  ON recommendation.cross_sell_matrix (tenant_id, priority DESC);

-- RLS
ALTER TABLE recommendation.cross_sell_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.cross_sell_matrix FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cross_sell_matrix_tenant_isolation ON recommendation.cross_sell_matrix;
CREATE POLICY cross_sell_matrix_tenant_isolation ON recommendation.cross_sell_matrix
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Health scores (append-only account relationship health history)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendation.health_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  account_id  uuid NOT NULL,
  -- Composite health score (0–100), banded in health/domain.ts.
  score       int NOT NULL,
  factors     jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_scores_tenant_id
  ON recommendation.health_scores (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_scores_tenant_account
  ON recommendation.health_scores (tenant_id, account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_scores_tenant_account_computed
  ON recommendation.health_scores (tenant_id, account_id, computed_at DESC);

-- RLS
ALTER TABLE recommendation.health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.health_scores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_scores_tenant_isolation ON recommendation.health_scores;
CREATE POLICY health_scores_tenant_isolation ON recommendation.health_scores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Recommendation feedback (accept / reject with mandatory rejection reason)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendation.recommendation_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  recommendation_id uuid NOT NULL,
  -- 'accepted' | 'rejected'
  action            varchar(24) NOT NULL,
  -- Mandatory when action = 'rejected' (enforced in feedback/domain.ts).
  reason            varchar(500),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendation_feedback_tenant_id
  ON recommendation.recommendation_feedback (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendation_feedback_tenant_rec
  ON recommendation.recommendation_feedback (tenant_id, recommendation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendation_feedback_tenant_recorded
  ON recommendation.recommendation_feedback (tenant_id, recorded_at DESC);

-- RLS
ALTER TABLE recommendation.recommendation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.recommendation_feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recommendation_feedback_tenant_isolation ON recommendation.recommendation_feedback;
CREATE POLICY recommendation_feedback_tenant_isolation ON recommendation.recommendation_feedback
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Outbox / Inbox (if not already created by the shared migration)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           varchar(128) NOT NULL,
  event_type      varchar(128) NOT NULL,
  tenant_id       uuid NOT NULL,
  actor_id        uuid NOT NULL,
  correlation_id  varchar(64) NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _outbox TO recommendation_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recommendation_svc;
    GRANT USAGE ON SCHEMA _inbox TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _inbox TO recommendation_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recommendation_svc;
  END IF;
END $$;
