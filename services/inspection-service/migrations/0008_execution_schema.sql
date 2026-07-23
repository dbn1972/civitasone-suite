-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0008_execution_schema.sql
-- Service:   inspection-service (gateway /api/v1/inspection) — DB civitas_inspection
--
-- Purpose:
--   Creates the `execution` schema with `inspections` and `inspection_history`
--   tables for the Execution module. The inspections table tracks the full
--   inspection lifecycle state machine (scheduled → in_progress → paused →
--   completed → under_review → finalized). The inspection_history table records
--   every state transition with actor, timestamp, and optional remarks.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (schema, table, indexes) or guarded (policy via DROP-then-CREATE),
--   so it can be re-applied safely.
--
-- Row-level security (RLS):
--   Both tables have ENABLE + FORCE ROW LEVEL SECURITY. The tenant_isolation
--   policy uses the missing-ok GUC form so an unset app.tenant_id yields NULL
--   → no rows visible (fail-closed).
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP POLICY IF EXISTS tenant_isolation ON execution.inspection_history;
--   DROP POLICY IF EXISTS tenant_isolation ON execution.inspections;
--   DROP INDEX IF EXISTS execution.idx_inspection_history_tenant_inspection;
--   DROP INDEX IF EXISTS execution.idx_inspections_tenant_state;
--   DROP TABLE IF EXISTS execution.inspection_history;
--   DROP TABLE IF EXISTS execution.inspections;
--   DROP SCHEMA IF EXISTS execution;
--
-- Affected services: inspection-service only (own database, no cross-service tables).
-- Requirements: 8.1, 8.8
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS execution;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: execution.inspections
--   State lifecycle: scheduled → in_progress → paused → in_progress → completed
--                    → under_review → finalized
--   assigned_inspectors stores a JSON array of inspector UUID strings.
--   plan_id is nullable (inspections can exist without a formal plan).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS execution.inspections (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    entity_id             UUID NOT NULL,
    plan_id               UUID,
    inspection_type_id    UUID NOT NULL,
    state                 VARCHAR(24) NOT NULL DEFAULT 'scheduled',
    assigned_inspectors   JSONB NOT NULL DEFAULT '[]'::jsonb,
    reviewer_id           UUID,
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    finalized_at          TIMESTAMPTZ,
    report_ref            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT chk_inspections_state
        CHECK (state IN ('scheduled', 'in_progress', 'paused', 'completed', 'under_review', 'finalized'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: execution.inspection_history
--   Records every state transition for audit and traceability.
--   References execution.inspections(id) to maintain referential integrity.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS execution.inspection_history (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    inspection_id     UUID NOT NULL REFERENCES execution.inspections(id),
    previous_state    VARCHAR(24) NOT NULL,
    new_state         VARCHAR(24) NOT NULL,
    actor_id          UUID NOT NULL,
    remarks           TEXT,
    transitioned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policy is dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE execution.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution.inspections FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON execution.inspections;
CREATE POLICY tenant_isolation ON execution.inspections
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE execution.inspection_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution.inspection_history FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON execution.inspection_history;
CREATE POLICY tenant_isolation ON execution.inspection_history
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty
--   at migration time, so index builds are instant and non-blocking.
--   All IF NOT EXISTS for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Filter inspections by tenant + state (list views, dashboards)
CREATE INDEX IF NOT EXISTS idx_inspections_tenant_state
    ON execution.inspections(tenant_id, state);

-- Look up history entries for a specific inspection within a tenant
CREATE INDEX IF NOT EXISTS idx_inspection_history_tenant_inspection
    ON execution.inspection_history(tenant_id, inspection_id);
