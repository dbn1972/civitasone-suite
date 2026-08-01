-- Purpose: Create crm.next_actions — mandatory next action on active leads and
--          opportunities (AC-002). Enables the "no active record without a next
--          step" compliance report.
-- Rollback: DROP TABLE IF EXISTS crm.next_actions;
-- Affected services: crm-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_type varchar(16) NOT NULL CHECK (subject_type IN ('contact', 'deal')),
  subject_id uuid NOT NULL,
  action_type varchar(40) NOT NULL,
  due_at timestamptz NOT NULL,
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_next_actions_tenant_id ON crm.next_actions(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_next_actions_subject ON crm.next_actions(tenant_id, subject_type, subject_id);
-- Partial index: the compliance report and the overdue list only ever look at
-- OPEN actions, so keep the hot index small.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_next_actions_open_due
  ON crm.next_actions(tenant_id, due_at) WHERE completed_at IS NULL;

ALTER TABLE crm.next_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.next_actions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'next_actions_tenant_isolation' AND tablename = 'next_actions'
  ) THEN
    CREATE POLICY next_actions_tenant_isolation ON crm.next_actions
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.next_actions TO crm_svc;
  END IF;
END $g$;
