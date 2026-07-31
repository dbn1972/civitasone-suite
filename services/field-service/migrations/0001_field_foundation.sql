-- Migration: 0001_field_foundation.sql
-- Purpose: Create foundation tables for field-service (tasks, visits, route_plans, sync_queue).
-- Affected services: field-service
--
-- Rollback (destroys data — requires explicit approval):
--   DROP TABLE IF EXISTS field.sync_queue;
--   DROP TABLE IF EXISTS field.route_plans;
--   DROP TABLE IF EXISTS field.visits;
--   DROP TABLE IF EXISTS field.tasks;
--   DROP SCHEMA IF EXISTS field;

SET lock_timeout = '5s';

-- Create schema
CREATE SCHEMA IF NOT EXISTS field;

-- ──────────────────────────────────────────────────────────────────────────────
-- Tasks table — field task assignments for agents
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field.tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  assignee_id    uuid,
  task_type      varchar(64) NOT NULL,
  title          varchar(256) NOT NULL,
  description    text,
  status         varchar(24) NOT NULL DEFAULT 'unassigned',
  priority       integer NOT NULL DEFAULT 3,
  latitude       numeric(10,7),
  longitude      numeric(10,7),
  address        text,
  due_date       timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_tenant_id ON field.tasks (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assignee_id ON field.tasks (tenant_id, assignee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_status ON field.tasks (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_due_date ON field.tasks (tenant_id, due_date);

-- ──────────────────────────────────────────────────────────────────────────────
-- Visits table — GPS-verified check-in/check-out records
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field.visits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  task_id              uuid NOT NULL REFERENCES field.tasks(id),
  agent_id             uuid NOT NULL,
  check_in_latitude    numeric(10,7),
  check_in_longitude   numeric(10,7),
  check_out_latitude   numeric(10,7),
  check_out_longitude  numeric(10,7),
  check_in_at          timestamptz,
  check_out_at         timestamptz,
  duration_minutes     integer,
  outcome              varchar(24),
  notes                text,
  photos               jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_tenant_id ON field.visits (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_task_id ON field.visits (tenant_id, task_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_agent_id ON field.visits (tenant_id, agent_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Route plans table — optimized daily routes for agents
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field.route_plans (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL,
  assignee_id                uuid NOT NULL,
  route_date                 date NOT NULL,
  status                     varchar(24) NOT NULL DEFAULT 'draft',
  waypoints                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  optimized_order            jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_distance_km          numeric(8,2),
  estimated_duration_minutes integer,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL,
  updated_by                 uuid NOT NULL,
  version                    integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_plans_tenant_id ON field.route_plans (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_plans_assignee_date ON field.route_plans (tenant_id, assignee_id, route_date);

-- ──────────────────────────────────────────────────────────────────────────────
-- Sync queue table — offline operations pending replay
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field.sync_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  agent_id          uuid NOT NULL,
  entity_type       varchar(32) NOT NULL,
  entity_id         uuid NOT NULL,
  operation         varchar(16) NOT NULL,
  payload           jsonb NOT NULL,
  client_timestamp  timestamptz NOT NULL,
  client_version    integer NOT NULL DEFAULT 1,
  status            varchar(24) NOT NULL DEFAULT 'pending',
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_queue_tenant_id ON field.sync_queue (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_queue_agent_status ON field.sync_queue (tenant_id, agent_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_queue_processed_at ON field.sync_queue (tenant_id, agent_id, processed_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS — Enable and force row-level security on all tables
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE field.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE field.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.visits FORCE ROW LEVEL SECURITY;

ALTER TABLE field.route_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.route_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE field.sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.sync_queue FORCE ROW LEVEL SECURITY;

-- RLS policies: tenant isolation on the app.tenant_id GUC.
--   * DROP ... IF EXISTS first so the migration stays idempotent on re-run.
--   * WITH CHECK mirrors USING so a row can never be written for another tenant.
--   * current_setting(..., true) (missing_ok) yields NULL rather than raising
--     when the GUC is unset — the policy then matches zero rows (fail-closed).
DROP POLICY IF EXISTS tenant_isolation_tasks ON field.tasks;
CREATE POLICY tenant_isolation_tasks ON field.tasks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_visits ON field.visits;
CREATE POLICY tenant_isolation_visits ON field.visits
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_route_plans ON field.route_plans;
CREATE POLICY tenant_isolation_route_plans ON field.route_plans
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_sync_queue ON field.sync_queue;
CREATE POLICY tenant_isolation_sync_queue ON field.sync_queue
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ──────────────────────────────────────────────────────────────────────────────
-- Grants — guarded so the migration stays runnable where the service login role
-- has not been provisioned yet (local dev / CI).
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'field_svc') THEN
    GRANT USAGE ON SCHEMA field TO field_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON field.tasks TO field_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON field.visits TO field_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON field.route_plans TO field_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON field.sync_queue TO field_svc;
  END IF;
END
$$;
