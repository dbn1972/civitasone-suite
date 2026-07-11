-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0003_court_notice.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Issuance & service of process (Court spec §21). Adds two tenant-scoped tables
--   to the existing `court` PostgreSQL schema:
--     • court.notices          — a notice issued to a party on a case.
--     • court.notice_service   — one row per service attempt against a notice
--                                (post/email/publication/personal/substituted) with
--                                its delivery status.
--   Enables (and FORCEs) row-level security with per-tenant isolation on both
--   tables and creates the read-path indexes.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes) or guarded (policies via DROP-then-CREATE), so
--   it can be re-applied safely.
--
-- Money: none (no monetary columns).
--
-- Row-level security (RLS) — the CORRECT form (mirrors 0001_court_core.sql):
--   Both tables have BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role is subject to the policy (ENABLE alone lets the owner bypass
--   RLS). The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC
--   yields NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS court.notice_service;
--   DROP TABLE IF EXISTS court.notices;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLES (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Notices (§21 issuance) ──────────────────────────────────────────────────────
-- status ∈ (issued|served|unserved|cancelled).
CREATE TABLE IF NOT EXISTS court.notices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    case_id      UUID NOT NULL,
    notice_type  VARCHAR(48) NOT NULL,
    issued_to    TEXT,
    status       VARCHAR(16) NOT NULL DEFAULT 'issued',
    issue_date   DATE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID,
    updated_by   UUID,
    version      INTEGER NOT NULL DEFAULT 1
);

-- ── Notice service attempts (§21 service of process) ────────────────────────────
-- service_mode    ∈ (post|email|publication|personal|substituted).
-- delivery_status ∈ (pending|served|unserved|refused).
CREATE TABLE IF NOT EXISTS court.notice_service (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    notice_id       UUID NOT NULL,
    service_mode    VARCHAR(24) NOT NULL,
    recipient       TEXT,
    dispatch_ref    VARCHAR(64),
    delivery_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    served_at       DATE,
    proof           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    version         INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy on every table.
--   FORCE ensures even the table owner is subject to the policy (ENABLE alone lets
--   the owner bypass RLS). The policy uses the missing-ok GUC form so an unset
--   app.tenant_id yields NULL → no rows (fail-closed) instead of raising.
--   USING also governs INSERT/UPDATE WITH CHECK (Postgres reuses the USING
--   expression), so writes cannot cross tenants. Policies are dropped-then-created
--   for idempotent re-runs (CREATE POLICY has no IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.notices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.notices        FORCE  ROW LEVEL SECURITY;
ALTER TABLE court.notice_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.notice_service FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.notices;
CREATE POLICY tenant_isolation ON court.notices
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON court.notice_service;
CREATE POLICY tenant_isolation ON court.notice_service
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_notices_tenant_case
    ON court.notices(tenant_id, case_id);

CREATE INDEX IF NOT EXISTS idx_notice_service_tenant_notice
    ON court.notice_service(tenant_id, notice_id);
