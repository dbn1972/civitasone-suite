-- Board-decision project intake (cross-service choreography, action side).
-- meeting-service `meeting.decision.project` opens a PENDING_REVIEW triage item
-- here; a competent project officer reviews and actions it via the service's own
-- flow. No auto-execution of project records.
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP TABLE project.project_board_decision_intake;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS project.project_board_decision_intake (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  source         varchar(24) NOT NULL DEFAULT 'meeting',
  decision_id    uuid NOT NULL,
  meeting_id     uuid NOT NULL,
  committee_id   uuid,
  text           text NOT NULL,
  project_ref    text,
  authority      varchar(200),
  effective_date date,
  status         varchar(16) NOT NULL DEFAULT 'pending_review',
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT project_board_decision_intake_status_chk
    CHECK (status IN ('pending_review', 'accepted', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS project_board_decision_intake_tenant_decision_uq
  ON project.project_board_decision_intake (tenant_id, decision_id);

CREATE INDEX IF NOT EXISTS project_board_decision_intake_tenant_status_idx
  ON project.project_board_decision_intake (tenant_id, status);

-- RLS: fail-closed tenant isolation mirroring the service's other tables
-- (USING + WITH CHECK against project.current_tenant_id()).
ALTER TABLE project.project_board_decision_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE project.project_board_decision_intake FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON project.project_board_decision_intake;
DROP POLICY IF EXISTS tenant_isolation ON project.project_board_decision_intake;
CREATE POLICY tenant_isolation_policy ON project.project_board_decision_intake
  USING (tenant_id = project.current_tenant_id())
  WITH CHECK (tenant_id = project.current_tenant_id());
