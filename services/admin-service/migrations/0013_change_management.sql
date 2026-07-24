-- SVC-130 Change, Release & User Communication.
--   Creates the `change` schema + tables (change_requests, change_freezes,
--   change_audit) and applies full tenant-isolation RLS mirroring migration
--   0006 (current_tenant_id() + ENABLE/FORCE ROW LEVEL SECURITY +
--   tenant_isolation_policy USING + WITH CHECK).
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP SCHEMA change CASCADE;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS change;

-- current_tenant_id() is created in 0006; re-declared here (CREATE OR REPLACE)
-- so this migration is self-contained if applied to a fresh database.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ── change.change_requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS change.change_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  title              text NOT NULL,
  type               varchar(16) NOT NULL,
  risk               varchar(16) NOT NULL DEFAULT 'medium',
  affected_services  jsonb NOT NULL DEFAULT '[]'::jsonb,
  description        text NOT NULL,
  rollback_plan      text,
  status             varchar(24) NOT NULL DEFAULT 'draft',
  requested_by       uuid NOT NULL,
  approved_by        uuid,
  approved_at        timestamptz,
  rejected_reason    text,
  window_start       timestamptz,
  window_end         timestamptz,
  release_notes      text,
  pir_outcome        varchar(16),
  pir_notes          text,
  pir_at             timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);

DO $$ BEGIN
  ALTER TABLE change.change_requests
    ADD CONSTRAINT change_requests_type_chk CHECK (type IN ('standard','normal','emergency'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE change.change_requests
    ADD CONSTRAINT change_requests_risk_chk CHECK (risk IN ('low','medium','high'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE change.change_requests
    ADD CONSTRAINT change_requests_status_chk CHECK (status IN
      ('draft','submitted','approved','rejected','scheduled','in_progress','completed','rolled_back'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS change_requests_tenant_idx ON change.change_requests (tenant_id);
CREATE INDEX IF NOT EXISTS change_requests_tenant_status_idx ON change.change_requests (tenant_id, status);

-- ── change.change_freezes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS change.change_freezes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         text NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS change_freezes_tenant_idx ON change.change_freezes (tenant_id);

-- ── change.change_audit ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS change.change_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  change_id       uuid NOT NULL,
  from_status     varchar(24),
  to_status       varchar(24) NOT NULL,
  actor_id        uuid NOT NULL,
  note            text,
  correlation_id  varchar(64),
  at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_audit_tenant_change_idx ON change.change_audit (tenant_id, change_id);

-- ── RLS: full tenant isolation (mirrors 0006) ──────────────────────────────
ALTER TABLE change.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE change.change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON change.change_requests;
DROP POLICY IF EXISTS tenant_isolation ON change.change_requests;
CREATE POLICY tenant_isolation_policy ON change.change_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE change.change_freezes ENABLE ROW LEVEL SECURITY;
ALTER TABLE change.change_freezes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON change.change_freezes;
DROP POLICY IF EXISTS tenant_isolation ON change.change_freezes;
CREATE POLICY tenant_isolation_policy ON change.change_freezes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE change.change_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE change.change_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON change.change_audit;
DROP POLICY IF EXISTS tenant_isolation ON change.change_audit;
CREATE POLICY tenant_isolation_policy ON change.change_audit
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
