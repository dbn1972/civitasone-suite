-- swm-service initial migration: complaints, bulk generators, collection
-- requests, field tasks, hotspots.
-- Applied with swm_svc role on civitas_swm.
-- Schema: civitas_swm (matches modules/*/schema.ts pgSchema("civitas_swm")
-- exactly — this migration also introduces the schema itself).
--
-- Baseline note: swm-service had ZERO migrations before this PR despite being
-- routed in the gateway registry (services/gateway-service/src/registry.ts:112)
-- and having 5 fully-implemented Drizzle table definitions across 4 modules.
-- The database/role/schema were never provisioned anywhere (no entry in
-- scripts/ci/bootstrap-postgres.sh SERVICE_DBS, no infra/db/bootstrap/*.sql
-- mention) — the service could not previously be booted against a real DB in
-- CI or locally. See infra/db/bootstrap/bootstrap_swm.sql for role/db/schema
-- creation, wired into scripts/ci/bootstrap-postgres.sh SERVICE_DBS in this
-- same PR.
--
-- CHECK constraints below mirror the zod enums in each module's routes.ts
-- exactly, so the app can never legitimately write a value the DB rejects.
--
-- Rollback strategy (manual — no destructive statements are run forward):
--   1. DROP POLICY tenant_isolation ON civitas_swm.<table>; for each table.
--   2. DROP TABLE IF EXISTS civitas_swm.<table>; for each table (field_tasks
--      and complaints/bulk_generators/collection_requests/hotspots have no
--      FK dependency ordering — all are independent, tenant_id-scoped only).
--   3. DROP FUNCTION IF EXISTS current_tenant_id(); -- only if 0002 (outbox)
--      does not depend on it (it doesn't — outbox/inbox are not tenant-scoped).
--   4. DROP SCHEMA IF EXISTS civitas_swm;
-- Affected services: swm-service only (new schema, no cross-service impact).

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS civitas_swm;

-- Shared RLS helper: reads the `app.tenant_id` GUC set per-request by the
-- tenant transaction hook (SET LOCAL app.tenant_id = '<tenant>').
-- Matches the canonical pattern documented in docs/DATABASE-SCHEMA.md and
-- used identically by every other service (e.g. visitor-service 0001).
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT current_setting('app.tenant_id', true)::uuid $$;

-- ── civitas_swm.swm_complaints ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS civitas_swm.swm_complaints (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  complaint_number  varchar(32) NOT NULL,
  reported_by       uuid        NOT NULL,
  location          jsonb,
  complaint_type    varchar(32) NOT NULL
    CHECK (complaint_type IN ('missed_collection', 'spillage', 'burning', 'illegal_dumping', 'overflow')),
  description       text,
  photo             text,
  severity          varchar(16)
    CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical')),
  status            varchar(24) NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'assigned', 'in_progress', 'resolved', 'closed')),
  assigned_to       uuid,
  resolution        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_swm_complaints_tenant
  ON civitas_swm.swm_complaints (tenant_id);
CREATE INDEX IF NOT EXISTS idx_swm_complaints_tenant_status
  ON civitas_swm.swm_complaints (tenant_id, status);

ALTER TABLE civitas_swm.swm_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_complaints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_complaints;
CREATE POLICY tenant_isolation ON civitas_swm.swm_complaints
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── civitas_swm.swm_bulk_generators ─────────────────────────────────
CREATE TABLE IF NOT EXISTS civitas_swm.swm_bulk_generators (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  registration_number         varchar(32) NOT NULL,
  generator_name              varchar(128) NOT NULL,
  generator_type              varchar(32) NOT NULL
    CHECK (generator_type IN ('hotel', 'restaurant', 'mall', 'hospital', 'market')),
  address                     jsonb,
  estimated_waste_kg_per_day  integer,
  category                    varchar(16) NOT NULL
    CHECK (category IN ('wet', 'dry', 'mixed')),
  status                      varchar(24) NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'active', 'suspended', 'cancelled')),
  fee_minor                   integer,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid        NOT NULL,
  updated_by                  uuid        NOT NULL,
  version                     integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_swm_bulk_generators_tenant
  ON civitas_swm.swm_bulk_generators (tenant_id);
CREATE INDEX IF NOT EXISTS idx_swm_bulk_generators_tenant_status
  ON civitas_swm.swm_bulk_generators (tenant_id, status);

ALTER TABLE civitas_swm.swm_bulk_generators ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_bulk_generators FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_bulk_generators;
CREATE POLICY tenant_isolation ON civitas_swm.swm_bulk_generators
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── civitas_swm.swm_collection_requests ─────────────────────────────
CREATE TABLE IF NOT EXISTS civitas_swm.swm_collection_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  request_number       varchar(32) NOT NULL,
  requested_by         uuid        NOT NULL,
  waste_type           varchar(32) NOT NULL
    CHECK (waste_type IN ('construction_debris', 'garden_waste', 'e_waste', 'hazardous', 'bulky_item')),
  estimated_quantity   text,
  address              jsonb,
  preferred_date       date,
  preferred_slot       varchar(24),
  status               varchar(24) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'scheduled', 'collected', 'cancelled')),
  vehicle_id           text,
  fee_minor            integer,
  fee_paid             boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_by           uuid        NOT NULL,
  version              integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_swm_collection_requests_tenant
  ON civitas_swm.swm_collection_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_swm_collection_requests_tenant_status
  ON civitas_swm.swm_collection_requests (tenant_id, status);

ALTER TABLE civitas_swm.swm_collection_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_collection_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_collection_requests;
CREATE POLICY tenant_isolation ON civitas_swm.swm_collection_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── civitas_swm.swm_field_tasks ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS civitas_swm.swm_field_tasks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  task_number   varchar(32) NOT NULL,
  route_id      text,
  zone_id       text,
  assigned_to   uuid,
  task_date     date,
  asset_refs    jsonb,
  status        varchar(24) NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed')),
  completed_at  timestamptz,
  notes         text,
  photos        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_swm_field_tasks_tenant
  ON civitas_swm.swm_field_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_swm_field_tasks_tenant_status
  ON civitas_swm.swm_field_tasks (tenant_id, status);

ALTER TABLE civitas_swm.swm_field_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_field_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_field_tasks;
CREATE POLICY tenant_isolation ON civitas_swm.swm_field_tasks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── civitas_swm.swm_hotspots ────────────────────────────────────────
-- category is free text in the app (z.string().max(32).optional() in
-- modules/analytics/routes.ts identifyBody) — no CHECK, unlike the other
-- enum-backed columns above.
CREATE TABLE IF NOT EXISTS civitas_swm.swm_hotspots (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  hotspot_code      varchar(32) NOT NULL,
  location          jsonb,
  category          varchar(32),
  complaint_count   integer     NOT NULL DEFAULT 0,
  risk_score        integer     NOT NULL DEFAULT 0,
  status            varchar(24) NOT NULL DEFAULT 'identified'
    CHECK (status IN ('identified', 'action_planned', 'resolved')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_swm_hotspots_tenant
  ON civitas_swm.swm_hotspots (tenant_id);
CREATE INDEX IF NOT EXISTS idx_swm_hotspots_tenant_status
  ON civitas_swm.swm_hotspots (tenant_id, status);

ALTER TABLE civitas_swm.swm_hotspots ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_swm.swm_hotspots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON civitas_swm.swm_hotspots;
CREATE POLICY tenant_isolation ON civitas_swm.swm_hotspots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
