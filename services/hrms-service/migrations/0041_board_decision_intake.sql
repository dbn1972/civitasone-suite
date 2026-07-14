-- Board-decision HR intake (cross-service choreography, action side).
-- meeting-service `meeting.decision.hr` opens a PENDING_REVIEW triage item here;
-- a competent HR officer reviews and actions it via the service's own flow.
-- No auto-execution of HR orders.
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP TABLE lifecycle.hrms_board_decision_intake;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS lifecycle.hrms_board_decision_intake (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  source         varchar(24) NOT NULL DEFAULT 'meeting',
  decision_id    uuid NOT NULL,
  meeting_id     uuid NOT NULL,
  committee_id   uuid,
  text           text NOT NULL,
  authority      varchar(200),
  effective_date date,
  status         varchar(16) NOT NULL DEFAULT 'pending_review',
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_board_decision_intake_status_chk
    CHECK (status IN ('pending_review', 'accepted', 'rejected'))
);

-- Idempotency: one intake item per (tenant, decision).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_board_decision_intake_tenant_decision_uq
  ON lifecycle.hrms_board_decision_intake (tenant_id, decision_id);

-- Pending-triage list lookup.
CREATE INDEX IF NOT EXISTS hrms_board_decision_intake_tenant_status_idx
  ON lifecycle.hrms_board_decision_intake (tenant_id, status);

-- RLS: fail-closed tenant isolation mirroring the service's other tables
-- (USING + WITH CHECK against employee.current_tenant_id(), which is
-- NULLIF(current_setting('app.tenant_id', true), '')::uuid).
ALTER TABLE lifecycle.hrms_board_decision_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_board_decision_intake FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.hrms_board_decision_intake;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_board_decision_intake;
CREATE POLICY tenant_isolation_policy ON lifecycle.hrms_board_decision_intake
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
