-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0003_planning_schema.sql
-- Service:   inspection-service (gateway /api/v1/inspection) — DB civitas_inspection
--
-- Purpose:
--   Creates the `planning` schema and `inspection_plans` table for the Planning
--   module. Inspection plans define which entities are selected for inspection
--   within a given period, based on risk thresholds and selection criteria.
--   Plans follow a lifecycle: draft → pending_approval → active.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (schema, table, indexes) or guarded (policy via DROP-then-CREATE),
--   so it can be re-applied safely.
--
-- Row-level security (RLS):
--   The table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role is subject to the policy. The tenant_isolation policy uses
--   the missing-ok GUC form `NULLIF(current_setting('app.tenant_id', true), '')::uuid`
--   so an UNSET GUC yields NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS planning.inspection_plans;
--   DROP SCHEMA IF EXISTS planning;
--
-- Affected services: inspection-service only (own database, no cross-service tables).
-- Requirements: 3.4, 3.5
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS planning;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: planning.inspection_plans
--   Status lifecycle: draft → pending_approval → active
--   entity_ids stores a JSON array of uuid strings representing selected entities.
--   selection_criteria stores filter rules used to derive the entity set.
--   workflow_instance_id links to an external workflow-service approval instance.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS planning.inspection_plans (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    name                  TEXT NOT NULL,
    description           TEXT,
    period_start          DATE NOT NULL,
    period_end            DATE NOT NULL,
    status                VARCHAR(24) NOT NULL DEFAULT 'draft',
    risk_threshold        INTEGER,
    selection_criteria    JSONB,
    entity_ids            JSONB NOT NULL,
    workflow_instance_id  UUID,
    approved_at           TIMESTAMPTZ,
    approved_by           UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT chk_inspection_plans_status
        CHECK (status IN ('draft', 'pending_approval', 'active'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policy is dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE planning.inspection_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.inspection_plans FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON planning.inspection_plans;
CREATE POLICY tenant_isolation ON planning.inspection_plans
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): this table is brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_inspection_plans_tenant_status
    ON planning.inspection_plans(tenant_id, status);
