-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0002_court_scrutiny.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Registry scrutiny + defect management (§13). After a filing is submitted the
--   registry scrutinizes it; if defective, one or more defects are raised with a
--   rectification deadline; once every defect is rectified/waived the case proceeds.
--   Adds two tenant-scoped tables to the existing `court` schema:
--     • court.case_scrutiny — one scrutiny record per case (pending|cleared|defective)
--     • court.case_defect   — the defects raised against a scrutiny/case
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes) or guarded (policies via DROP-then-CREATE), so
--   it can be re-applied safely.
--
-- Money:
--   Not involved in this module.
--
-- Row-level security (RLS) — the CORRECT form (mirrors 0001_court_core.sql):
--   Both tables get BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role is subject to the policy (ENABLE alone lets the owner bypass
--   RLS). The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC yields
--   NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS court.case_defect;
--   DROP TABLE IF EXISTS court.case_scrutiny;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLES (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Case scrutiny ──────────────────────────────────────────────────────────────
-- One registry scrutiny record per case: pending → cleared, pending → defective,
-- defective → cleared (once raised defects are rectified/waived).
CREATE TABLE IF NOT EXISTS court.case_scrutiny (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    case_id        UUID NOT NULL,
    status         VARCHAR(24) NOT NULL DEFAULT 'pending',
    scrutinized_by UUID,
    remarks        TEXT,
    scrutinized_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    version        INTEGER NOT NULL DEFAULT 1
);

-- ── Case defect ────────────────────────────────────────────────────────────────
-- Defects raised against a scrutiny/case: raised → rectified, raised → waived,
-- raised → rejected. `rectification_deadline` is the date by which a curable
-- defect must be rectified.
CREATE TABLE IF NOT EXISTS court.case_defect (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL,
    case_id                UUID NOT NULL,
    scrutiny_id            UUID,
    category               VARCHAR(48) NOT NULL,
    description            TEXT NOT NULL,
    severity               VARCHAR(16) NOT NULL DEFAULT 'minor',
    status                 VARCHAR(16) NOT NULL DEFAULT 'raised',
    rectification_deadline DATE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID,
    updated_by             UUID,
    version                INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy on both tables.
--   FORCE ensures even the table owner is subject to the policy (ENABLE alone lets
--   the owner bypass RLS). The policy uses the missing-ok GUC form so an unset
--   app.tenant_id yields NULL → no rows (fail-closed) instead of raising. USING also
--   governs INSERT/UPDATE WITH CHECK (Postgres reuses the USING expression), so
--   writes cannot cross tenants. Policies are dropped-then-created for idempotent
--   re-runs (CREATE POLICY has no IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.case_scrutiny ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.case_scrutiny FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.case_defect   ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.case_defect   FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.case_scrutiny;
CREATE POLICY tenant_isolation ON court.case_scrutiny
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.case_defect;
CREATE POLICY tenant_isolation ON court.case_defect
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_case_scrutiny_tenant_case ON court.case_scrutiny(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_case_defect_tenant_case   ON court.case_defect(tenant_id, case_id);
