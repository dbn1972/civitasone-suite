-- Migration: 0020_resolution_indent_intake.sql
-- Purpose: Intake table for board-resolution procurement decisions
--          (meeting.decision.procurement). A consumer opens a PENDING REVIEW item;
--          a procurement officer reviews and actions it through the normal indent
--          flow. This does NOT auto-create a real indent (GFR / maker-checker).
-- Rollback: DROP TABLE IF EXISTS indent.procurement_resolution_indent_intake;
-- Affected services: procurement-service (resolution-intake module)
-- Requirements: 22.1 (cross-service choreography — board decision -> procurement intake)

BEGIN;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS indent.procurement_resolution_indent_intake (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  source         VARCHAR(16) NOT NULL DEFAULT 'meeting' CHECK (source IN ('meeting')),
  decision_id    UUID NOT NULL,
  meeting_id     UUID,
  committee_id   UUID,
  title          TEXT,
  text           TEXT NOT NULL,
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
  CONSTRAINT uq_procurement_resolution_indent_intake_tenant_decision UNIQUE (tenant_id, decision_id)
);

CREATE INDEX IF NOT EXISTS idx_procurement_resolution_indent_intake_tenant_status
  ON indent.procurement_resolution_indent_intake (tenant_id, status);

-- RLS: fail-closed tenant isolation, mirroring indent.procurement_indents (0010).
-- indent.current_tenant_id() = current_setting('app.tenant_id', false)::uuid
ALTER TABLE indent.procurement_resolution_indent_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE indent.procurement_resolution_indent_intake FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON indent.procurement_resolution_indent_intake;
CREATE POLICY tenant_isolation ON indent.procurement_resolution_indent_intake
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

COMMIT;
