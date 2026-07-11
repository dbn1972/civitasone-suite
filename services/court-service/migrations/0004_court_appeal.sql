-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0004_court_appeal.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Adds the `court.appeals` table implementing Court spec §25 (appeal / revision /
--   review). An appeal is filed against an ORIGINAL case's order, is registered,
--   and is then decided (allowed | dismissed | remanded | modified) or withdrawn.
--   The module is self-contained: it owns ONE table carrying a `status` + `version`
--   (optimistic-lock column) and emits its own domain events via the transactional
--   outbox. It intentionally does NOT write to court.case_state_transitions — the
--   appeal lifecycle is independent of the original case's lifecycle.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (table, indexes) or guarded (policy via DROP-then-CREATE), so it
--   can be re-applied safely.
--
-- Row-level security (RLS) — the CORRECT form (mirrors 0001_court_core.sql):
--   court.appeals has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role is subject to the policy (ENABLE alone lets the owner bypass
--   RLS). The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC
--   yields NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS court.appeals;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Appeals (§25 appeal / revision / review) ──────────────────────────────────
-- status lifecycle: filed → registered → { allowed | dismissed | remanded |
-- modified | withdrawn }; filed → withdrawn is also legal. Terminal states carry
-- no onward transition. `version` is the standard optimistic-lock column.
CREATE TABLE IF NOT EXISTS court.appeals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    original_case_id  UUID NOT NULL,
    appellate_case_id UUID,
    appeal_type       VARCHAR(24) NOT NULL DEFAULT 'appeal',
    grounds           TEXT NOT NULL,
    status            VARCHAR(16) NOT NULL DEFAULT 'filed',
    filed_date        DATE NOT NULL,
    decided_date      DATE,
    decision_summary  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID,
    updated_by        UUID,
    version           INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   Mirrors the 0001_court_core.sql RLS block: FORCE ensures even the table owner
--   is subject to the policy; the missing-ok GUC form fails closed on an unset
--   app.tenant_id. USING also governs INSERT/UPDATE WITH CHECK (Postgres reuses
--   the USING expression), so writes cannot cross tenants. Dropped-then-created
--   for idempotent re-runs (CREATE POLICY has no IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.appeals FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.appeals;
CREATE POLICY tenant_isolation ON court.appeals
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): this table is brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT
--   EXISTS for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_appeals_case   ON court.appeals(tenant_id, original_case_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON court.appeals(tenant_id, status);
