-- smarttransfer-service initial migration (ST-M01-12).
-- Schema: smarttransfer (all movement entities); plus _outbox / _inbox.
-- Role: smarttransfer_svc owns the schema and connects to civitas_smarttransfer.
-- RLS: FORCE ROW LEVEL SECURITY + tenant_id isolation on every smarttransfer.*
--      domain table (spec §14, D-ST-10). Migration numbering starts at 0001.
--
-- Columns verified 1:1 against src/modules/movement/schema.ts (minimal v1).
-- NO columns depending on PROPOSED decisions (solver detail D-ST-05, policy
-- D-ST-07, signing D-ST-12, payroll D-ST-13/14, override D-ST-18) — see the PR
-- body for the explicit list that is deliberately deferred.
--
-- Conventions (matched to building-service/migrations/0001_init.sql,
-- advertisement-service, shop-service):
--   - _outbox.messages and _inbox.command_results (the two tenant_id infra
--     tables) are FORCE RLS too (D-20 for command_results, house rule 2 for
--     the outbox). smarttransfer_svc is NOBYPASSRLS, so the cross-tenant outbox
--     relay and the retention purge run as the dedicated BYPASSRLS
--     smarttransfer_scanner role (0002_smarttransfer_scanner_role.sql), exactly
--     like court-service. _inbox.processed has no tenant_id (message_id only),
--     so there is nothing to scope there.
--   - inline `NULLIF(current_setting('app.tenant_id', true), '')::uuid`
--     predicate per policy, guarded by an idempotent DO block checking
--     pg_policies (no SECURITY DEFINER helper function).
--   - (tenant_id) and (tenant_id, status) indexes on every domain table, plus
--     FK-shaped indexes on the owning-parent id columns.
--
-- Rollback: DROP SCHEMA smarttransfer CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS smarttransfer;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ===================== _outbox / _inbox (CQRS) =====================
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid        NOT NULL,
  actor_id       uuid        NOT NULL,
  correlation_id varchar(64) NOT NULL,
  schema_version varchar(16) NOT NULL DEFAULT '1.0',
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
-- RLS on _outbox.messages is applied below; relay/purge use smarttransfer_scanner.
CREATE INDEX IF NOT EXISTS idx_smarttransfer_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- D-20: command-result store. FORCE RLS (policy below); reads/writes run in the
-- caller's/consumer's tenant transaction. The retention purge (30d rejected/failed,
-- 7d succeeded) runs as the smarttransfer_scanner role only, which is granted
-- SELECT + DELETE and nothing else on this table (see 0002).
CREATE TABLE IF NOT EXISTS _inbox.command_results (
  message_id     uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  topic          varchar(128) NOT NULL,
  status         varchar(16) NOT NULL CHECK (status IN ('succeeded', 'rejected', 'failed')),
  reason         text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  code           varchar(64),
  params         jsonb,
  actor_id       uuid,
  correlation_id varchar(64),
  resource_type  varchar(64),
  resource_id    uuid,
  attempts       integer NOT NULL DEFAULT 1,
  retryable      boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smarttransfer_command_results_tenant
  ON _inbox.command_results (tenant_id);

-- ===================== Movement entity tables =====================
-- Each table carries: id, tenant_id, jurisdiction_unit_id, status, created_at,
-- updated_at, created_by, updated_by, version, plus its own minimal refs.

-- smarttransfer.cycles
CREATE TABLE IF NOT EXISTS smarttransfer.cycles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'draft',
  name                 varchar(200) NOT NULL,
  movement_type_id     uuid,
  calendar             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS cycles_tenant_idx ON smarttransfer.cycles (tenant_id);
CREATE INDEX IF NOT EXISTS cycles_status_idx ON smarttransfer.cycles (tenant_id, status);
CREATE INDEX IF NOT EXISTS cycles_jurisdiction_idx ON smarttransfer.cycles (tenant_id, jurisdiction_unit_id);

-- smarttransfer.requests
CREATE TABLE IF NOT EXISTS smarttransfer.requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'draft',
  cycle_id             uuid NOT NULL,
  employee_id          uuid NOT NULL,
  movement_type_id     uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS requests_tenant_idx ON smarttransfer.requests (tenant_id);
CREATE INDEX IF NOT EXISTS requests_status_idx ON smarttransfer.requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS requests_cycle_idx ON smarttransfer.requests (cycle_id);

-- smarttransfer.preferences
CREATE TABLE IF NOT EXISTS smarttransfer.preferences (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'draft',
  cycle_id             uuid NOT NULL,
  employee_id          uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS preferences_tenant_idx ON smarttransfer.preferences (tenant_id);
CREATE INDEX IF NOT EXISTS preferences_status_idx ON smarttransfer.preferences (tenant_id, status);
CREATE INDEX IF NOT EXISTS preferences_cycle_idx ON smarttransfer.preferences (cycle_id);

-- smarttransfer.preference_items
CREATE TABLE IF NOT EXISTS smarttransfer.preference_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'active',
  preference_id        uuid NOT NULL,
  post_id              uuid NOT NULL,
  rank                 integer NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS preference_items_tenant_idx ON smarttransfer.preference_items (tenant_id);
CREATE INDEX IF NOT EXISTS preference_items_preference_idx ON smarttransfer.preference_items (preference_id);

-- smarttransfer.scenarios
CREATE TABLE IF NOT EXISTS smarttransfer.scenarios (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'draft',
  cycle_id             uuid NOT NULL,
  name                 varchar(200) NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS scenarios_tenant_idx ON smarttransfer.scenarios (tenant_id);
CREATE INDEX IF NOT EXISTS scenarios_status_idx ON smarttransfer.scenarios (tenant_id, status);
CREATE INDEX IF NOT EXISTS scenarios_cycle_idx ON smarttransfer.scenarios (cycle_id);

-- smarttransfer.runs
CREATE TABLE IF NOT EXISTS smarttransfer.runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'requested',
  cycle_id             uuid NOT NULL,
  scenario_id          uuid,
  snapshot_id          uuid,
  seed                 integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS runs_tenant_idx ON smarttransfer.runs (tenant_id);
CREATE INDEX IF NOT EXISTS runs_status_idx ON smarttransfer.runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS runs_cycle_idx ON smarttransfer.runs (cycle_id);

-- smarttransfer.assignments
CREATE TABLE IF NOT EXISTS smarttransfer.assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'proposed',
  run_id               uuid NOT NULL,
  employee_id          uuid NOT NULL,
  post_id              uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS assignments_tenant_idx ON smarttransfer.assignments (tenant_id);
CREATE INDEX IF NOT EXISTS assignments_status_idx ON smarttransfer.assignments (tenant_id, status);
CREATE INDEX IF NOT EXISTS assignments_run_idx ON smarttransfer.assignments (run_id);

-- smarttransfer.orders
CREATE TABLE IF NOT EXISTS smarttransfer.orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'drafted',
  assignment_id        uuid NOT NULL,
  employee_id          uuid NOT NULL,
  order_number         varchar(64),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS orders_tenant_idx ON smarttransfer.orders (tenant_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON smarttransfer.orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS orders_assignment_idx ON smarttransfer.orders (assignment_id);

-- smarttransfer.relieving_records
CREATE TABLE IF NOT EXISTS smarttransfer.relieving_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'pending',
  order_id             uuid NOT NULL,
  employee_id          uuid NOT NULL,
  source_office_id     uuid,
  relieved_on          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS relieving_records_tenant_idx ON smarttransfer.relieving_records (tenant_id);
CREATE INDEX IF NOT EXISTS relieving_records_status_idx ON smarttransfer.relieving_records (tenant_id, status);
CREATE INDEX IF NOT EXISTS relieving_records_order_idx ON smarttransfer.relieving_records (order_id);

-- smarttransfer.joining_records
CREATE TABLE IF NOT EXISTS smarttransfer.joining_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'pending',
  order_id             uuid NOT NULL,
  employee_id          uuid NOT NULL,
  dest_office_id       uuid,
  joined_on            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS joining_records_tenant_idx ON smarttransfer.joining_records (tenant_id);
CREATE INDEX IF NOT EXISTS joining_records_status_idx ON smarttransfer.joining_records (tenant_id, status);
CREATE INDEX IF NOT EXISTS joining_records_order_idx ON smarttransfer.joining_records (order_id);

-- smarttransfer.appeals
CREATE TABLE IF NOT EXISTS smarttransfer.appeals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'submitted',
  order_id             uuid NOT NULL,
  employee_id          uuid NOT NULL,
  ground_code          varchar(64),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS appeals_tenant_idx ON smarttransfer.appeals (tenant_id);
CREATE INDEX IF NOT EXISTS appeals_status_idx ON smarttransfer.appeals (tenant_id, status);
CREATE INDEX IF NOT EXISTS appeals_order_idx ON smarttransfer.appeals (order_id);

-- smarttransfer.evidence
CREATE TABLE IF NOT EXISTS smarttransfer.evidence (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  jurisdiction_unit_id uuid,
  status               varchar(32) NOT NULL DEFAULT 'recorded',
  run_id               uuid NOT NULL,
  snapshot_hash        varchar(128),
  policy_pack_hash     varchar(128),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS evidence_tenant_idx ON smarttransfer.evidence (tenant_id);
CREATE INDEX IF NOT EXISTS evidence_run_idx ON smarttransfer.evidence (run_id);

-- ===================== FORCE RLS + tenant_isolation on every domain table =====
-- Per-table ENABLE + FORCE + CREATE POLICY, literal (not a loop) so the
-- same-file RLS requirement is statically verifiable (SEC-010 guard) and matches
-- the house pattern (building-service/migrations/0001_init.sql).

ALTER TABLE smarttransfer.cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.cycles FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='cycles' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.cycles
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.requests FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='requests' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.requests
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.preferences FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='preferences' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.preferences
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.preference_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.preference_items FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='preference_items' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.preference_items
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.scenarios FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='scenarios' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.scenarios
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.runs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='runs' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.runs
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.assignments FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='assignments' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.assignments
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.orders FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='orders' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.orders
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.relieving_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.relieving_records FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='relieving_records' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.relieving_records
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.joining_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.joining_records FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='joining_records' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.joining_records
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.appeals FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='appeals' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.appeals
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE smarttransfer.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarttransfer.evidence FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='smarttransfer' AND tablename='evidence' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON smarttransfer.evidence
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

-- ===================== RLS: infra tables with tenant_id =====================
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='_outbox' AND tablename='messages' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON _outbox.messages
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE _inbox.command_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE _inbox.command_results FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='_inbox' AND tablename='command_results' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON _inbox.command_results
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

-- ===================== Grants =====================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smarttransfer_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO smarttransfer_svc;
    GRANT USAGE ON SCHEMA _inbox TO smarttransfer_svc;
    GRANT SELECT, INSERT ON _outbox.messages TO smarttransfer_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO smarttransfer_svc;
    GRANT SELECT, INSERT, UPDATE ON _inbox.command_results TO smarttransfer_svc;
    -- smarttransfer_svc OWNS the table, so it holds DELETE implicitly; D-20 reserves the
    -- purge to the scanner role, so drop it from the owner explicitly.
    REVOKE DELETE ON _inbox.command_results FROM smarttransfer_svc;
    GRANT USAGE ON SCHEMA smarttransfer TO smarttransfer_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA smarttransfer TO smarttransfer_svc;
  END IF;
END $$;
