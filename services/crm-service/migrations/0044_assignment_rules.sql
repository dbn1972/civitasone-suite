-- Purpose: Lead assignment engine wiring (AS-001). Migration 0016 already created
--          a stub crm.assignment_rules (columns: type/criteria/ordinal/enabled) for
--          the then-orphaned engine. This migration brings it up to what the wired
--          engine + admin CRUD need — a display name, an explicit fallback owner, a
--          persisted round-robin cursor, and the widened rule-type set
--          (product/segment/language/capacity in addition to the original three) —
--          and creates crm.lead_assignment_log, the immutable record of every
--          routing decision ("New leads are routed according to active rule and
--          logged"). The round-robin cursor lives on the rule row so cycling
--          resumes across restarts without a separate table.
-- Rollback: DROP TABLE IF EXISTS crm.lead_assignment_log;
--           ALTER TABLE crm.assignment_rules DROP COLUMN IF EXISTS name,
--             DROP COLUMN IF EXISTS fallback_owner_id, DROP COLUMN IF EXISTS rr_cursor;
-- Affected services: crm-service
-- Sequencing: additive — new columns (0 existing rows, so NOT NULL DEFAULTs are
--             safe) + a new table. A tenant with zero rules keeps today's behaviour
--             (inbound leads captured unassigned).

SET lock_timeout = '5s';

ALTER TABLE crm.assignment_rules
  ADD COLUMN IF NOT EXISTS name varchar(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fallback_owner_id uuid,
  -- Round-robin cursor: last-assigned roster index. -1 so the first assignment
  -- yields index 0 (engine picks (rr_cursor + 1) mod len, skipping ineligibles).
  ADD COLUMN IF NOT EXISTS rr_cursor integer NOT NULL DEFAULT -1;

-- Widen the rule-type set. 0016 constrained `type` to the original three; the wired
-- engine also supports product/segment/language attribute matches and a capacity
-- rule. Drop + recreate by name so re-running converges (ADD CONSTRAINT IF NOT
-- EXISTS is not valid PostgreSQL).
ALTER TABLE crm.assignment_rules DROP CONSTRAINT IF EXISTS assignment_rules_type_check;
DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assignment_rules_type_check'
      AND conrelid = 'crm.assignment_rules'::regclass
  ) THEN
    ALTER TABLE crm.assignment_rules
      ADD CONSTRAINT assignment_rules_type_check CHECK (type IN (
        'territory', 'round_robin', 'score_threshold', 'product', 'segment', 'language', 'capacity'
      ));
  END IF;
END $c$;

CREATE TABLE IF NOT EXISTS crm.lead_assignment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  -- NULL for a manual pick, a fallback assignment, or a transfer.
  rule_id uuid,
  method varchar(16) NOT NULL
    CONSTRAINT lead_assignment_log_method_check CHECK (method IN ('auto', 'manual', 'transfer')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_assignment_log_lead
  ON crm.lead_assignment_log(tenant_id, lead_id, assigned_at);

ALTER TABLE crm.lead_assignment_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_assignment_log FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'lead_assignment_log_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'lead_assignment_log'
  ) THEN
    CREATE POLICY lead_assignment_log_tenant_isolation ON crm.lead_assignment_log
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.assignment_rules TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_assignment_log TO crm_svc;
  END IF;
END $g$;
