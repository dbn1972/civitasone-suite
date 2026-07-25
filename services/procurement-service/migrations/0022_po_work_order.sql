-- Migration: 0022_po_work_order.sql
-- Purpose: SVC-046 PO / Work-order. Adds order_type to PO (supply/service/work),
--          PO/WO amendment + change-order versioning (maker-checker), and
--          delivery-schedule / milestone tracking with closure.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS po.procurement_po_milestones, po.procurement_po_amendments;
--           ALTER TABLE po.procurement_pos DROP COLUMN IF EXISTS order_type;
-- Affected services: procurement-service (po module)
-- Requirements: SVC-046

BEGIN;

SET lock_timeout = '5s';

ALTER TABLE po.procurement_pos
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(16) NOT NULL DEFAULT 'supply';
DO $$ BEGIN
  ALTER TABLE po.procurement_pos
    ADD CONSTRAINT procurement_pos_order_type_chk
    CHECK (order_type IN ('supply', 'service', 'work'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS po.procurement_po_amendments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id            UUID NOT NULL,
  tenant_id        UUID NOT NULL,
  amendment_no     INTEGER NOT NULL,
  amendment_type   VARCHAR(24) NOT NULL DEFAULT 'scope'
                     CHECK (amendment_type IN ('quantity', 'price', 'schedule', 'scope', 'change_order')),
  status           VARCHAR(16) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  reason           TEXT NOT NULL,
  delta_minor      BIGINT NOT NULL DEFAULT 0,
  prev_total_minor BIGINT NOT NULL DEFAULT 0,
  new_total_minor  BIGINT NOT NULL DEFAULT 0,
  currency         CHAR(3) NOT NULL DEFAULT 'INR',
  effective_date   DATE,
  requested_by     UUID NOT NULL,
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  rejected_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL,
  updated_by       UUID NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_po_amendment_no UNIQUE (po_id, amendment_no)
);
CREATE INDEX IF NOT EXISTS ix_po_amendment_tenant ON po.procurement_po_amendments (tenant_id);

CREATE TABLE IF NOT EXISTS po.procurement_po_milestones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  milestone_no  INTEGER NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  due_date      DATE,
  amount_minor  BIGINT NOT NULL DEFAULT 0,
  currency      CHAR(3) NOT NULL DEFAULT 'INR',
  delivered_qty INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'delivered', 'delayed', 'closed')),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_po_milestone_no UNIQUE (po_id, milestone_no)
);
CREATE INDEX IF NOT EXISTS ix_po_milestone_tenant ON po.procurement_po_milestones (tenant_id);

-- RLS: fail-closed tenant isolation (indent.current_tenant_id()).
ALTER TABLE po.procurement_po_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_po_amendments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON po.procurement_po_amendments;
CREATE POLICY tenant_isolation ON po.procurement_po_amendments
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

ALTER TABLE po.procurement_po_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE po.procurement_po_milestones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON po.procurement_po_milestones;
CREATE POLICY tenant_isolation ON po.procurement_po_milestones
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

COMMIT;
