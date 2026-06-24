-- P0-4: persist compliance checklists (previously an in-memory array lost on restart).
-- Additive + idempotent. Applied with audit_svc role on civitas_audit after 0006.

CREATE TABLE IF NOT EXISTS compliance.audit_checklists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  title        text NOT NULL,
  description  text,
  items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed    boolean NOT NULL DEFAULT false,
  completed_by uuid,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  version      integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_audit_checklists_tenant
  ON compliance.audit_checklists (tenant_id, created_at DESC);
