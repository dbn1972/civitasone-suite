-- Purpose: Create crm.recurring_tasks — recurring follow-up definitions with
--          overdue escalation windows (AC-005).
-- Rollback: DROP TABLE IF EXISTS crm.recurring_tasks;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.recurring_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  subject_type varchar(16) NOT NULL CHECK (subject_type IN ('contact', 'deal')),
  subject_id uuid NOT NULL,
  cadence varchar(16) NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly', 'quarterly')),
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  -- Hours after due_at before the materialised action is escalated to the
  -- owner's manager. NULL = no escalation configured.
  escalate_after_hours integer,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recurring_tasks_tenant_id ON crm.recurring_tasks(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recurring_tasks_subject ON crm.recurring_tasks(tenant_id, subject_type, subject_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recurring_tasks_due
  ON crm.recurring_tasks(tenant_id, next_run_at) WHERE enabled;

ALTER TABLE crm.recurring_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.recurring_tasks FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'recurring_tasks_tenant_isolation' AND tablename = 'recurring_tasks'
  ) THEN
    CREATE POLICY recurring_tasks_tenant_isolation ON crm.recurring_tasks
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.recurring_tasks TO crm_svc;
  END IF;
END $g$;
