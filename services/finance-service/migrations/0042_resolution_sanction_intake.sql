-- Migration: 0042_resolution_sanction_intake.sql
-- Purpose: Intake table for board-resolution financial decisions
--          (meeting.decision.financial). A consumer opens a PENDING REVIEW item;
--          a finance officer reviews and actions it through the normal sanction
--          flow. This does NOT auto-create a real sanction (GFR / maker-checker).
-- Rollback: DROP TABLE IF EXISTS budget.finance_resolution_sanction_intake;
-- Affected services: finance-service (resolution-intake module)
-- Requirements: 22.2 (cross-service choreography — board decision -> finance intake)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS budget.finance_resolution_sanction_intake (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  source         VARCHAR(16) NOT NULL DEFAULT 'meeting' CHECK (source IN ('meeting')),
  decision_id    UUID NOT NULL,
  meeting_id     UUID,
  committee_id   UUID,
  title          TEXT,
  text           TEXT NOT NULL,
  amount_minor   BIGINT NOT NULL DEFAULT 0,
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  authority      TEXT,
  effective_date DATE,
  status         VARCHAR(24) NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('pending_review', 'accepted', 'rejected')),
  reviewed_by    UUID,
  reviewed_at    TIMESTAMPTZ,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  version        INT NOT NULL DEFAULT 1,
  -- Idempotency: a replayed decision must not create a second intake per tenant.
  CONSTRAINT uq_finance_resolution_sanction_intake_tenant_decision UNIQUE (tenant_id, decision_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_resolution_sanction_intake_tenant_status
  ON budget.finance_resolution_sanction_intake (tenant_id, status);

-- RLS: fail-closed tenant isolation, mirroring budget.finance_sanctions (0035).
-- budget.current_tenant_id() = NULLIF(current_setting('app.tenant_id', true), '')::uuid
ALTER TABLE budget.finance_resolution_sanction_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_resolution_sanction_intake FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_resolution_sanction_intake;
CREATE POLICY tenant_isolation_policy ON budget.finance_resolution_sanction_intake
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
