-- revenue-service: maker-checker, versioned, effective-dated rate configuration
-- Purpose: Owner decision #2 (2026-10-26, GAP-REVENUE-CONFIG-01). Rate heads, slabs,
--          penalty rules and rebate rules drive every demand, penalty and rebate, so
--          a change is PROPOSED by revenue_admin and applied only when a DIFFERENT
--          officer approves it. Edits never change a row in place: they end-date the
--          old row and insert a new version with an effective date. Deactivation is
--          an end-date. rates.config_proposals holds the pending/decided proposals.
--          penalty_rules / rebate_rules / rate_heads gain the effective-date columns
--          the rate engine now honours (existing rows: effective from the epoch,
--          open-ended, so historical computations are unchanged).
-- Rollback: DROP TABLE rates.config_proposals;
--           ALTER TABLE rates.rate_heads DROP COLUMN effective_to;
--           ALTER TABLE rates.penalty_rules DROP COLUMN effective_from, DROP COLUMN effective_to;
--           ALTER TABLE rates.rebate_rules DROP COLUMN effective_from, DROP COLUMN effective_to;
-- Affected services: revenue-service

SET lock_timeout = '5s';

ALTER TABLE rates.rate_heads
  ADD COLUMN IF NOT EXISTS effective_to date;

ALTER TABLE rates.penalty_rules
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT DATE '1970-01-01',
  ADD COLUMN IF NOT EXISTS effective_to   date;

ALTER TABLE rates.rebate_rules
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT DATE '1970-01-01',
  ADD COLUMN IF NOT EXISTS effective_to   date;

CREATE TABLE IF NOT EXISTS rates.config_proposals (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  kind             varchar(16) NOT NULL CHECK (kind IN ('rate_head', 'rate_slab', 'penalty_rule', 'rebate_rule')),
  action           varchar(16) NOT NULL CHECK (action IN ('create', 'revise', 'end_date')),
  target_id        uuid,
  rate_head_id     uuid,
  effective_from   date NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  maker_user_id    uuid NOT NULL,
  checker_user_id  uuid,
  decided_at       timestamptz,
  decision_reason  text,
  applied_ref      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_config_proposals_tenant_status
  ON rates.config_proposals (tenant_id, status, created_at DESC);

ALTER TABLE rates.config_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.config_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rates.config_proposals;
CREATE POLICY tenant_isolation ON rates.config_proposals
  USING      (tenant_id = rates.current_tenant_id())
  WITH CHECK (tenant_id = rates.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON rates.config_proposals TO revenue_svc;
