-- Purpose: G3 — per-stage SLA configuration for journey/deal stages.
-- Allows tenants to configure SLA hours per stage code, with warning thresholds and breach actions.
-- Rollback: DROP TABLE IF EXISTS crm.stage_sla_policies;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.stage_sla_policies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  stage_code      varchar(60) NOT NULL,
  sla_hours       integer     NOT NULL CHECK (sla_hours > 0),
  warn_at_percent integer     NOT NULL DEFAULT 80 CHECK (warn_at_percent BETWEEN 1 AND 99),
  breach_action   varchar(12) NOT NULL DEFAULT 'notify' CHECK (breach_action IN ('notify', 'escalate', 'both')),
  notify_roles    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  escalation_target_id uuid,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  CONSTRAINT uq_stage_sla_tenant_stage UNIQUE (tenant_id, stage_code)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stage_sla_policies_tenant
  ON crm.stage_sla_policies (tenant_id) WHERE active = true;
