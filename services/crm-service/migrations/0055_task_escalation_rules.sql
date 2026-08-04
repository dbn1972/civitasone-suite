-- Purpose: AC-005 overdue-task manager escalation. crm.task_escalation_rules holds
--   per-tenant thresholds + a manager recipient. A worker scheduler finds open
--   next-actions / task-type activities whose due date passed by more than
--   threshold_minutes and escalates them (crm.task.escalated) to the manager.
--   crm.list_task_escalation_tenants() (SECURITY DEFINER) lets the non-superuser
--   worker discover enabled tenants past FORCE RLS — tenant ids only, mirroring
--   crm.list_escalation_tenants() from migration 0047.
-- Rollback: DROP FUNCTION IF EXISTS crm.list_task_escalation_tenants();
--           DROP TABLE IF EXISTS crm.task_escalation_rules;
-- Affected services: crm-service (activities module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.task_escalation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  -- Which overdue work this rule watches: mandatory next-actions, task activities, or both.
  applies_to varchar(12) NOT NULL DEFAULT 'both'
    CHECK (applies_to IN ('next_action', 'task', 'both')),
  threshold_minutes integer NOT NULL CHECK (threshold_minutes > 0),
  recipient_role varchar(64),
  recipient_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_escalation_rules_tenant
  ON crm.task_escalation_rules(tenant_id) WHERE enabled = true;

ALTER TABLE crm.task_escalation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.task_escalation_rules FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'task_escalation_rules_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'task_escalation_rules'
  ) THEN
    CREATE POLICY task_escalation_rules_tenant_isolation ON crm.task_escalation_rules
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION crm.list_task_escalation_tenants()
RETURNS TABLE(tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, pg_temp
AS $fn$
  SELECT DISTINCT r.tenant_id FROM crm.task_escalation_rules r WHERE r.enabled = true;
$fn$;

REVOKE ALL ON FUNCTION crm.list_task_escalation_tenants() FROM PUBLIC;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.task_escalation_rules TO crm_svc;
    GRANT EXECUTE ON FUNCTION crm.list_task_escalation_tenants() TO crm_svc;
  END IF;
END $g$;
