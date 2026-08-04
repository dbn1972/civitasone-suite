-- Purpose: Lead escalation of unaccepted / unattended leads (AS-004).
--          * contacts gains assigned_at / accepted_at / escalated_at so the
--            worker can tell how long a lead has waited and whether it was ever
--            accepted (POST /v1/crm/leads/:id/accept sets accepted_at).
--          * crm.escalation_rules holds the per-tenant thresholds + recipients.
--          * crm.list_escalation_tenants() lets the (non-superuser) worker
--            discover which tenants have enabled rules despite FORCE RLS — it is
--            SECURITY DEFINER, owned by the superuser running this migration, so
--            it bypasses RLS for discovery only. Per-tenant lead data is still
--            read under that tenant's own RLS scope by the scheduler.
-- Rollback: DROP FUNCTION IF EXISTS crm.list_escalation_tenants();
--           DROP TABLE IF EXISTS crm.escalation_rules;
--           ALTER TABLE crm.contacts DROP COLUMN IF EXISTS assigned_at, DROP COLUMN IF EXISTS accepted_at, DROP COLUMN IF EXISTS escalated_at;
-- Affected services: crm-service
-- Sequencing: additive columns (nullable, no backfill) + a new table + a
--             read-only function. Safe to apply before the worker code.

SET lock_timeout = '5s';

ALTER TABLE crm.contacts
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

-- Partial index for the scheduler's candidate scan: assigned, not yet escalated.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_escalation_scan
  ON crm.contacts(tenant_id)
  WHERE assigned_at IS NOT NULL AND escalated_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.escalation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  trigger varchar(16) NOT NULL
    CONSTRAINT escalation_rules_trigger_check CHECK (trigger IN ('unaccepted', 'unattended')),
  threshold_minutes integer NOT NULL CHECK (threshold_minutes > 0),
  recipient_role varchar(64),
  recipient_id uuid,
  reassign boolean NOT NULL DEFAULT false,
  reassign_owner_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escalation_rules_tenant
  ON crm.escalation_rules(tenant_id) WHERE enabled = true;

ALTER TABLE crm.escalation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.escalation_rules FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'escalation_rules_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'escalation_rules'
  ) THEN
    CREATE POLICY escalation_rules_tenant_isolation ON crm.escalation_rules
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- Discovery-only helper. SECURITY DEFINER runs as this migration's (superuser)
-- owner, which bypasses RLS, so the worker can enumerate tenants with enabled
-- rules. It returns ONLY tenant ids — no lead or rule data crosses tenants — and
-- the scheduler reads each tenant's actual leads under normal RLS afterwards.
CREATE OR REPLACE FUNCTION crm.list_escalation_tenants()
RETURNS TABLE(tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, pg_temp
AS $fn$
  SELECT DISTINCT er.tenant_id FROM crm.escalation_rules er WHERE er.enabled = true;
$fn$;

-- A SECURITY DEFINER function is granted to PUBLIC by default. Since it runs with
-- the (superuser) owner's rights and bypasses RLS, it must NOT be callable by every
-- role — only the crm-service role needs it. REVOKE first (idempotent), then GRANT
-- narrowly, so re-running this migration always converges to exactly crm_svc.
REVOKE ALL ON FUNCTION crm.list_escalation_tenants() FROM PUBLIC;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.escalation_rules TO crm_svc;
    GRANT EXECUTE ON FUNCTION crm.list_escalation_tenants() TO crm_svc;
  END IF;
END $g$;
