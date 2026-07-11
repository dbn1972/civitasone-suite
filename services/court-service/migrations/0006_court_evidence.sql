-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0006_court_evidence.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Adds the evidence & exhibits table for Court spec §22 (evidence & exhibits).
--   A party submits a piece of evidence/exhibit (title, type, an S3 storage
--   reference to the underlying file, and a SHA-256 content hash for
--   tamper-evidence); the presiding officer then rules on it
--   (admit | reject | mark). ONE table: `court.evidence`.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes) or guarded (policy via DROP-then-CREATE), so it
--   can be re-applied safely.
--
-- Tamper-evidence:
--   court.evidence.content_hash holds the lowercase hex SHA-256 digest (64 chars)
--   of the file referenced by storage_ref. The digest is computed by the app layer;
--   the DB stores it verbatim so re-computation can detect post-submission
--   tampering. storage_ref is an opaque S3 object reference, never the file bytes.
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
--   DROP TABLE IF EXISTS court.evidence;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Evidence & exhibits (§22): status lifecycle
--   submitted → {admitted | rejected | marked}
--   marked    → {admitted | rejected}
-- admitted and rejected are terminal. ruled_at is stamped when the presiding
-- officer rules (admit | reject | mark).
CREATE TABLE IF NOT EXISTS court.evidence (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    case_id        UUID NOT NULL,
    filing_id      UUID,
    exhibit_number VARCHAR(32),
    title          TEXT NOT NULL,
    evidence_type  VARCHAR(32) NOT NULL DEFAULT 'document',
    storage_ref    VARCHAR(512),
    content_hash   VARCHAR(64),
    status         VARCHAR(16) NOT NULL DEFAULT 'submitted',
    submitted_by   UUID,
    ruling_remarks TEXT,
    ruled_by       UUID,
    ruled_at       TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    version        INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policy is dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.evidence FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.evidence;
CREATE POLICY tenant_isolation ON court.evidence
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): this table is brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_evidence_tenant_case
    ON court.evidence(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_tenant_status
    ON court.evidence(tenant_id, status);
