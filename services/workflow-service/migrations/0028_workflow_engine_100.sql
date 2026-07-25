-- 0028_workflow_engine_100.sql
-- CAP-025 authority matrix, CAP-026 quorum/committee approvals, CAP-027 working
-- calendars + SLA pauses, CAP-029 instance finalization/reversal.
-- Additive + idempotent (CREATE ... IF NOT EXISTS). Every new table carries
-- tenant_id and is protected by ENABLE + FORCE RLS with a tenant_isolation
-- policy (USING + WITH CHECK) mirroring migration 0018.
-- Rollback: DROP the tables listed below (reverse dependency order).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION workflow.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ===========================================================================
-- CAP-025 — Delegation-of-power + monetary authority matrix
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workflow.authority_limits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  scope_type             varchar(16) NOT NULL,        -- role | designation | user
  scope_ref              varchar(128) NOT NULL,
  authority_type         varchar(16) NOT NULL DEFAULT 'financial', -- financial | administrative
  currency               varchar(8)  NOT NULL DEFAULT 'INR',
  max_amount             numeric(18,2) NOT NULL,
  effective_from         date NOT NULL,
  effective_to           date,
  escalate_to_scope_type varchar(16),
  escalate_to_ref        varchar(128),
  status                 varchar(16) NOT NULL DEFAULT 'draft', -- draft | active | revoked
  reason                 varchar(256),
  created_by             uuid NOT NULL,
  approved_by            uuid,                          -- maker-checker: distinct from created_by
  approved_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authority_scope_type_chk CHECK (scope_type IN ('role','designation','user')),
  CONSTRAINT authority_type_chk CHECK (authority_type IN ('financial','administrative')),
  CONSTRAINT authority_status_chk CHECK (status IN ('draft','active','revoked')),
  CONSTRAINT authority_amount_nonneg_chk CHECK (max_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_authority_limits_tenant ON workflow.authority_limits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_authority_limits_lookup
  ON workflow.authority_limits(tenant_id, authority_type, scope_type, scope_ref, status);

-- ===========================================================================
-- CAP-026 — Committee / quorum approvals
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workflow.committee_decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  instance_id   uuid,
  task_id       uuid,
  node_key      varchar(64),
  subject       varchar(256) NOT NULL,
  rule          varchar(16) NOT NULL DEFAULT 'majority', -- majority | unanimous | threshold
  threshold     integer,
  total_members integer NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'open',      -- open | decided
  outcome       varchar(16),                              -- approve | reject
  decided_at    timestamptz,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT committee_rule_chk CHECK (rule IN ('majority','unanimous','threshold')),
  CONSTRAINT committee_status_chk CHECK (status IN ('open','decided')),
  CONSTRAINT committee_outcome_chk CHECK (outcome IS NULL OR outcome IN ('approve','reject')),
  CONSTRAINT committee_members_chk CHECK (total_members > 0)
);
CREATE INDEX IF NOT EXISTS idx_committee_decisions_tenant ON workflow.committee_decisions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_committee_decisions_instance ON workflow.committee_decisions(tenant_id, instance_id);

CREATE TABLE IF NOT EXISTS workflow.committee_votes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  decision_id  uuid NOT NULL REFERENCES workflow.committee_decisions(id) ON DELETE CASCADE,
  voter_id     uuid NOT NULL,
  vote         varchar(16) NOT NULL,                       -- approve | reject | abstain
  reason       varchar(512),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT committee_vote_chk CHECK (vote IN ('approve','reject','abstain')),
  CONSTRAINT committee_vote_unique UNIQUE (decision_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_committee_votes_tenant ON workflow.committee_votes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_committee_votes_decision ON workflow.committee_votes(decision_id);

-- ===========================================================================
-- CAP-027 — Working calendars + SLA pauses
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workflow.working_calendars (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  code              varchar(64) NOT NULL,
  name              varchar(200) NOT NULL,
  timezone          varchar(64) NOT NULL DEFAULT 'UTC',
  workweek          jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,  -- 0=Sun..6=Sat
  holidays          jsonb NOT NULL DEFAULT '[]'::jsonb,           -- ["YYYY-MM-DD", ...]
  work_start_minute integer NOT NULL DEFAULT 540,                 -- 09:00
  work_end_minute   integer NOT NULL DEFAULT 1020,                -- 17:00
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT working_calendar_window_chk CHECK (work_end_minute > work_start_minute
    AND work_start_minute >= 0 AND work_end_minute <= 1440),
  CONSTRAINT working_calendar_code_unique UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_working_calendars_tenant ON workflow.working_calendars(tenant_id);

CREATE TABLE IF NOT EXISTS workflow.task_sla_pauses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  task_id     uuid NOT NULL,
  paused_at   timestamptz NOT NULL DEFAULT now(),
  resumed_at  timestamptz,
  reason      varchar(256),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_sla_pauses_tenant ON workflow.task_sla_pauses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_sla_pauses_task ON workflow.task_sla_pauses(tenant_id, task_id);
-- at most one OPEN (un-resumed) pause per task
CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_sla_pause_open
  ON workflow.task_sla_pauses(task_id) WHERE resumed_at IS NULL;

-- ===========================================================================
-- CAP-029 — Instance finalization / reversal
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workflow.instance_finalizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  instance_id     uuid NOT NULL,
  finalized_by    uuid NOT NULL,
  finalized_at    timestamptz NOT NULL DEFAULT now(),
  reversed        boolean NOT NULL DEFAULT false,
  reversed_by     uuid,
  reversed_at     timestamptz,
  reversal_reason varchar(512),
  impact          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instance_finalization_unique UNIQUE (instance_id)
);
CREATE INDEX IF NOT EXISTS idx_instance_finalizations_tenant ON workflow.instance_finalizations(tenant_id);

-- ===========================================================================
-- RLS — ENABLE + FORCE + tenant_isolation policy (USING + WITH CHECK)
-- ===========================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'authority_limits',
    'committee_decisions',
    'committee_votes',
    'working_calendars',
    'task_sla_pauses',
    'instance_finalizations'
  ] LOOP
    EXECUTE format('ALTER TABLE workflow.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE workflow.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON workflow.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON workflow.%I '
      'USING (tenant_id = workflow.current_tenant_id()) '
      'WITH CHECK (tenant_id = workflow.current_tenant_id())', t);
  END LOOP;
END $$;

-- Runtime GRANTs — new tables may be owned by the migration role (civitas_admin);
-- the service role (workflow_svc) needs DML. Mirrors migration 0006.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workflow_svc') THEN
    GRANT USAGE ON SCHEMA workflow TO workflow_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      workflow.authority_limits,
      workflow.committee_decisions,
      workflow.committee_votes,
      workflow.working_calendars,
      workflow.task_sla_pauses,
      workflow.instance_finalizations
      TO workflow_svc;
  END IF;
END $$;
