-- Migration: 0027_business_calendars.sql
-- Purpose: Create helpdesk.business_calendars for SLA business-hours-aware deadline computation
-- Rollback: DROP TABLE IF EXISTS helpdesk.business_calendars;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.business_calendars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(255) NOT NULL,
  timezone    varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
  work_days   jsonb NOT NULL,
  holidays    jsonb DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  version     int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_business_calendars_tenant
  ON helpdesk.business_calendars (tenant_id);

-- RLS
ALTER TABLE helpdesk.business_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.business_calendars FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'business_calendars' AND policyname = 'business_calendars_tenant_isolation'
  ) THEN
    CREATE POLICY business_calendars_tenant_isolation ON helpdesk.business_calendars
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON helpdesk.business_calendars TO helpdesk_svc;
