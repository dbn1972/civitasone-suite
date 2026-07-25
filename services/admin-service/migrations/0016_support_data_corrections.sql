-- CAP-100 Support console — data-correction governance (maker-checker).
--   Creates support.admin_data_corrections with full tenant-isolation RLS
--   mirroring migration 0013. Additive + idempotent.
-- Rollback: DROP TABLE support.admin_data_corrections;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS support;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS support.admin_data_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  target_table     varchar(160) NOT NULL,
  target_id        varchar(160) NOT NULL,
  justification    text NOT NULL,
  proposed_change  jsonb NOT NULL,
  ticket_id        uuid,
  status           varchar(16) NOT NULL DEFAULT 'pending',
  proposed_by      uuid NOT NULL,
  approved_by      uuid,
  approved_at      timestamptz,
  rejected_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

DO $$ BEGIN
  ALTER TABLE support.admin_data_corrections
    ADD CONSTRAINT admin_data_corrections_status_chk CHECK (status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS admin_data_corrections_tenant_status_idx
  ON support.admin_data_corrections (tenant_id, status);

ALTER TABLE support.admin_data_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.admin_data_corrections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON support.admin_data_corrections;
CREATE POLICY tenant_isolation_policy ON support.admin_data_corrections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
