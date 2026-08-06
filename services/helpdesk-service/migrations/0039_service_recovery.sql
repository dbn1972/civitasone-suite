-- Purpose: G8 — Service recovery / goodwill entitlement model.
--   Adds recovery_policies (configurable per tenant/severity/product) and
--   recovery_actions (per-ticket goodwill recommendations with approval workflow).
-- Rollback: DROP TABLE IF EXISTS helpdesk.recovery_actions; DROP TABLE IF EXISTS helpdesk.recovery_policies;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

-- Recovery policies: configurable per tenant, defines when goodwill is eligible
CREATE TABLE IF NOT EXISTS helpdesk.recovery_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  severity_threshold varchar(24) NOT NULL,
  product_code  varchar(64),
  max_goodwill_minor bigint NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'INR',
  requires_approval boolean NOT NULL DEFAULT true,
  approver_role varchar(64) NOT NULL DEFAULT 'helpdesk_manager',
  active        boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 1,
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recovery_policies_tenant
  ON helpdesk.recovery_policies (tenant_id, active);

-- Recovery actions: individual goodwill/recovery recommendations per ticket
CREATE TABLE IF NOT EXISTS helpdesk.recovery_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  policy_id     uuid NOT NULL REFERENCES helpdesk.recovery_policies(id),
  action_type   varchar(24) NOT NULL
    CHECK (action_type IN ('goodwill_credit', 'replacement', 'priority_service', 'apology_comm')),
  amount_minor  bigint,
  currency      char(3) NOT NULL DEFAULT 'INR',
  status        varchar(24) NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'executed')),
  approved_by   uuid,
  approved_at   timestamptz,
  reason        text,
  version       integer NOT NULL DEFAULT 1,
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recovery_actions_ticket
  ON helpdesk.recovery_actions (tenant_id, ticket_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recovery_actions_status
  ON helpdesk.recovery_actions (tenant_id, status);

-- RLS
ALTER TABLE helpdesk.recovery_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.recovery_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY recovery_policies_tenant ON helpdesk.recovery_policies
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE helpdesk.recovery_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.recovery_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY recovery_actions_tenant ON helpdesk.recovery_actions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
