-- Migration: 0021_procurement_planning.sql
-- Purpose: SVC-041 Annual procurement planning. Yearly demand plan (header + lines)
--          aggregated from approved indents, with maker-checker approval and
--          plan-line -> tender linkage.
-- Additive + idempotent (CREATE ... IF NOT EXISTS). Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS planning.procurement_plan_lines, planning.procurement_plans;
--           DROP SCHEMA IF EXISTS planning;
-- Affected services: procurement-service (planning module)
-- Requirements: SVC-041

BEGIN;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS planning;

CREATE TABLE IF NOT EXISTS planning.procurement_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  plan_no               TEXT NOT NULL,
  plan_year             INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  department            TEXT NOT NULL,
  status                VARCHAR(24) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  total_estimated_minor BIGINT NOT NULL DEFAULT 0,
  currency              CHAR(3) NOT NULL DEFAULT 'INR',
  notes                 TEXT,
  submitted_by          UUID,
  submitted_at          TIMESTAMPTZ,
  approved_by           UUID,
  approved_at           TIMESTAMPTZ,
  rejected_reason       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL,
  updated_by            UUID NOT NULL,
  version               INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_proc_plans_tenant_no UNIQUE (tenant_id, plan_no)
);
CREATE INDEX IF NOT EXISTS ix_proc_plans_tenant_year
  ON planning.procurement_plans (tenant_id, plan_year);

CREATE TABLE IF NOT EXISTS planning.procurement_plan_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id               UUID NOT NULL,
  tenant_id             UUID NOT NULL,
  item_code             TEXT NOT NULL,
  description           TEXT NOT NULL,
  aggregated_qty        INTEGER NOT NULL DEFAULT 0,
  uom                   VARCHAR(32) NOT NULL DEFAULT 'nos',
  procurement_category  VARCHAR(24) NOT NULL DEFAULT 'goods'
                          CHECK (procurement_category IN ('goods', 'services', 'works')),
  procurement_method    VARCHAR(24) NOT NULL DEFAULT 'gem'
                          CHECK (procurement_method IN ('direct_purchase', 'gem', 'limited_tender', 'advertised_tender', 'single_tender')),
  budget_line           TEXT,
  estimated_value_minor BIGINT NOT NULL DEFAULT 0,
  currency              CHAR(3) NOT NULL DEFAULT 'INR',
  timeline_quarter      VARCHAR(8),
  package_group         VARCHAR(64),
  source_indent_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  tender_id             UUID,
  tender_linked_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL,
  updated_by            UUID NOT NULL,
  version               INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_proc_plan_lines_plan   ON planning.procurement_plan_lines (plan_id);
CREATE INDEX IF NOT EXISTS ix_proc_plan_lines_tenant ON planning.procurement_plan_lines (tenant_id);

-- RLS: fail-closed tenant isolation (mirrors 0010/0020; indent.current_tenant_id()).
ALTER TABLE planning.procurement_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.procurement_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON planning.procurement_plans;
CREATE POLICY tenant_isolation ON planning.procurement_plans
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

ALTER TABLE planning.procurement_plan_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.procurement_plan_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON planning.procurement_plan_lines;
CREATE POLICY tenant_isolation ON planning.procurement_plan_lines
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

COMMIT;
