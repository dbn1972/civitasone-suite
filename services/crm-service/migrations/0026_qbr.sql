-- Purpose: Create crm.qbr_schedules for quarterly business reviews (KA-005).
-- Rollback: DROP TABLE IF EXISTS crm.qbr_schedules;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.qbr_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  -- Fiscal quarter label, e.g. '2026-Q1'. Stored as text (not a date range)
  -- because tenants use differing fiscal calendars.
  quarter varchar(7) NOT NULL,
  scheduled_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  attendees jsonb NOT NULL DEFAULT '[]',
  agenda jsonb NOT NULL DEFAULT '[]',
  outcomes jsonb NOT NULL DEFAULT '[]',
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  -- Exactly one QBR per account per quarter — that is the review cadence.
  CONSTRAINT qbr_schedules_tenant_account_quarter_uk UNIQUE (tenant_id, account_id, quarter)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qbr_schedules_tenant_id ON crm.qbr_schedules(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qbr_schedules_account_id ON crm.qbr_schedules(account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qbr_schedules_scheduled_at ON crm.qbr_schedules(tenant_id, scheduled_at);

ALTER TABLE crm.qbr_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.qbr_schedules FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'qbr_schedules_tenant_isolation' AND tablename = 'qbr_schedules'
  ) THEN
    CREATE POLICY qbr_schedules_tenant_isolation ON crm.qbr_schedules
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.qbr_schedules TO crm_svc;
  END IF;
END $g$;
