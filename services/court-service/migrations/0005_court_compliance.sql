-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0005_court_compliance.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Adds the compliance-monitoring table for Court spec §26 (execution / compliance
--   monitoring of orders). After an order is passed, a compliance DIRECTION is
--   created (what must be done, by whom, by when); progress is recorded against it;
--   and it is closed as completed | verified | non_compliant. ONE table:
--   `court.compliance_directions`.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes) or guarded (policy via DROP-then-CREATE), so it
--   can be re-applied safely.
--
-- Row-level security (RLS) — the CORRECT form (mirrors 0001_court_core.sql):
--   The table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role is subject to the policy (ENABLE alone lets the owner bypass
--   RLS). The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC yields
--   NULL (rows invisible — fail-closed) instead of raising. USING also governs
--   INSERT/UPDATE WITH CHECK (Postgres reuses the USING expression), so writes
--   cannot cross tenants.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS court.compliance_directions;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Compliance directions (§26): status lifecycle
--   pending → in_progress → {completed → verified | non_compliant}
-- closed_at is stamped when a direction reaches a terminal state
-- (verified | non_compliant).
CREATE TABLE IF NOT EXISTS court.compliance_directions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    case_id               UUID NOT NULL,
    order_id              UUID,
    direction             TEXT NOT NULL,
    responsible_authority VARCHAR(120),
    due_date              DATE,
    status                VARCHAR(16) NOT NULL DEFAULT 'pending',
    progress_notes        TEXT,
    closed_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID,
    updated_by            UUID,
    version               INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policy is dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.compliance_directions ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.compliance_directions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.compliance_directions;
CREATE POLICY tenant_isolation ON court.compliance_directions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): this table is brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_compliance_tenant_case
    ON court.compliance_directions(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_compliance_tenant_status_due
    ON court.compliance_directions(tenant_id, status, due_date);
