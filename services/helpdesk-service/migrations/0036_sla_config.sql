-- Purpose: create helpdesk.sla_config, which sla-engine/routes.ts has always
--          queried but which no migration in this repo has ever created.
--          GET/PATCH /v1/helpdesk/sla/config, GET /v1/helpdesk/sla/breaches and
--          GET /v1/helpdesk/sla/metrics all fail at runtime without it — this is
--          a live defect, not only a red test. Verified absent on the deployed
--          stack: civitas_helpdesk has 27 tables in schema helpdesk, none named
--          sla_config.
-- Rollback: DROP TABLE IF EXISTS helpdesk.sla_config;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS helpdesk;

CREATE TABLE IF NOT EXISTS helpdesk.sla_config (
  tenant_id               uuid        NOT NULL,
  priority                varchar(24) NOT NULL,
  response_time_minutes   integer     NOT NULL,
  resolution_time_minutes integer     NOT NULL,
  -- Nullable: routes.ts inserts `escalate_after_minutes ?? null` because the
  -- request body makes it optional — a tenant may want an SLA with no automatic
  -- escalation.
  escalate_after_minutes  integer,
  updated_by              uuid        NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- The PATCH handler upserts with ON CONFLICT (tenant_id, priority), so this
  -- composite key is required for that statement to work at all, not merely for
  -- lookup speed. It also enforces one rule per priority per tenant.
  CONSTRAINT sla_config_pkey PRIMARY KEY (tenant_id, priority),

  -- The route validates priority with a zod enum of these four lowercase values.
  -- Constraining the column too keeps a direct SQL write from introducing a
  -- priority that the breaches query's LOWER() join would silently drop.
  CONSTRAINT sla_config_priority_check
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),

  -- The route requires min(1) on both; mirror it so the invariant survives a
  -- write that does not go through the route.
  CONSTRAINT sla_config_response_positive   CHECK (response_time_minutes > 0),
  CONSTRAINT sla_config_resolution_positive CHECK (resolution_time_minutes > 0),
  CONSTRAINT sla_config_escalate_positive
    CHECK (escalate_after_minutes IS NULL OR escalate_after_minutes > 0)
);

-- RLS
ALTER TABLE helpdesk.sla_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.sla_config FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sla_config' AND schemaname = 'helpdesk' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON helpdesk.sla_config
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;

-- Restricted grant
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON helpdesk.sla_config TO helpdesk_app;
  END IF;
END $$;
