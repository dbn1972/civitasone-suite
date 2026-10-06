-- Purpose: F6-01 — a generic, tenant-scoped status-transition log for case-like
--   resources (service requests and RTI requests). One row is written in the SAME
--   transaction as each status transition, recording from/to status, the actor and
--   an optional free-text note/reason, so the SR and RTI detail pages can render a
--   trustworthy timeline. `resource_type` discriminates the owning module so a
--   single table serves both without a cross-module join.
-- Rollback: DROP TABLE IF EXISTS crm.case_status_history;
-- Affected services: crm-service (service-requests + rti modules)
-- Sequencing: additive — one new tenant-scoped table, no backfill, no column changes.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.case_status_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  resource_type varchar(32) NOT NULL
                CHECK (resource_type IN ('service_request', 'rti_request')),
  resource_id   uuid        NOT NULL,
  from_status   varchar(32),
  to_status     varchar(32) NOT NULL,
  note          text,
  actor_id      uuid        NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_status_history_resource
  ON crm.case_status_history (tenant_id, resource_type, resource_id, at);

ALTER TABLE crm.case_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.case_status_history FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'case_status_history_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'case_status_history'
  ) THEN
    CREATE POLICY case_status_history_tenant_isolation ON crm.case_status_history
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT ON crm.case_status_history TO crm_svc;
  END IF;
END $g$;
