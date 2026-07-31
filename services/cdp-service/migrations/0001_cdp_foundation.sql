-- Purpose: CDP Foundation — profiles, identity graph, event store, segments, merge queue.
-- Rollback: DROP SCHEMA cdp CASCADE; (destructive — requires explicit approval)
-- Affected services: cdp-service only
SET lock_timeout = '5s';

-- Schema
CREATE SCHEMA IF NOT EXISTS cdp;

-- Service role
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    CREATE ROLE cdp_svc LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA cdp TO cdp_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cdp TO cdp_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA cdp GRANT ALL ON TABLES TO cdp_svc;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA cdp TO cdp_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA cdp GRANT ALL ON SEQUENCES TO cdp_svc;

-- ────────────────────────────────────────────────────────────────────────────
-- Profiles (golden profile store)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdp.profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  profile_type  varchar(32) NOT NULL DEFAULT 'individual',
  attributes    jsonb NOT NULL DEFAULT '{}',
  source_lineage jsonb NOT NULL DEFAULT '[]',
  merged_from_ids jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_tenant_id
  ON cdp.profiles (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_tenant_type
  ON cdp.profiles (tenant_id, profile_type) WHERE profile_type != 'merged';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_updated_at
  ON cdp.profiles (tenant_id, updated_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_attributes_gin
  ON cdp.profiles USING gin (attributes);

-- RLS
ALTER TABLE cdp.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_tenant_isolation ON cdp.profiles;
CREATE POLICY profiles_tenant_isolation ON cdp.profiles
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Identity Graph (cross-source identity resolution)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdp.identity_graph (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  profile_id      uuid NOT NULL REFERENCES cdp.profiles(id),
  identifier_type varchar(64) NOT NULL,
  identifier_hash varchar(256) NOT NULL,
  confidence      numeric(5,4) NOT NULL DEFAULT 1.0000,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_identity_graph_hash
  ON cdp.identity_graph (tenant_id, identifier_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_identity_graph_profile
  ON cdp.identity_graph (tenant_id, profile_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_identity_graph_tenant_type_hash
  ON cdp.identity_graph (tenant_id, identifier_type, identifier_hash);

-- RLS
ALTER TABLE cdp.identity_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.identity_graph FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identity_graph_tenant_isolation ON cdp.identity_graph;
CREATE POLICY identity_graph_tenant_isolation ON cdp.identity_graph
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Event Store (immutable customer interaction log)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdp.event_store (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  profile_id  uuid NOT NULL REFERENCES cdp.profiles(id),
  event_type  varchar(128) NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_store_profile
  ON cdp.event_store (tenant_id, profile_id, occurred_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_store_type
  ON cdp.event_store (tenant_id, event_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_store_occurred
  ON cdp.event_store (tenant_id, occurred_at DESC);

-- RLS
ALTER TABLE cdp.event_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.event_store FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_store_tenant_isolation ON cdp.event_store;
CREATE POLICY event_store_tenant_isolation ON cdp.event_store
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Segments (dynamic audience definitions)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdp.segments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(200) NOT NULL,
  description   varchar(1000),
  segment_type  varchar(32) NOT NULL DEFAULT 'dynamic',
  criteria      jsonb NOT NULL DEFAULT '{}',
  status        varchar(24) NOT NULL DEFAULT 'active',
  member_count  int NOT NULL DEFAULT 0,
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segments_tenant
  ON cdp.segments (tenant_id) WHERE is_archived = false;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segments_tenant_status
  ON cdp.segments (tenant_id, status) WHERE is_archived = false;

-- RLS
ALTER TABLE cdp.segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.segments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS segments_tenant_isolation ON cdp.segments;
CREATE POLICY segments_tenant_isolation ON cdp.segments
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Merge Queue (steward review)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdp.merge_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  source_profile_id uuid NOT NULL REFERENCES cdp.profiles(id),
  target_profile_id uuid NOT NULL REFERENCES cdp.profiles(id),
  confidence        numeric(5,4) NOT NULL,
  match_reason      varchar(500),
  status            varchar(24) NOT NULL DEFAULT 'pending',
  decided_by        uuid,
  decided_at        timestamptz,
  decision_reason   varchar(1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merge_queue_tenant_status
  ON cdp.merge_queue (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merge_queue_pending
  ON cdp.merge_queue (tenant_id, created_at DESC) WHERE status = 'pending';

-- RLS
ALTER TABLE cdp.merge_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.merge_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merge_queue_tenant_isolation ON cdp.merge_queue;
CREATE POLICY merge_queue_tenant_isolation ON cdp.merge_queue
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Outbox / Inbox (if not already created by shared migration)
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

GRANT USAGE ON SCHEMA _outbox TO cdp_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA _outbox TO cdp_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox GRANT ALL ON TABLES TO cdp_svc;
GRANT USAGE ON SCHEMA _inbox TO cdp_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA _inbox TO cdp_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox GRANT ALL ON TABLES TO cdp_svc;
