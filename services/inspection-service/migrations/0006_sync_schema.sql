-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0006_sync_schema.sql
-- Service:   inspection-service — DB civitas_inspection
--
-- Purpose:
--   Creates the `sync` PostgreSQL schema with three domain tables:
--   - sync.sync_packages: offline data bundles for field inspectors
--   - sync.sync_uploads: queued offline inspection results awaiting processing
--   - sync.sync_cursors: per-device sequence tracking for partial resume
--
--   Enables (and FORCEs) row-level security with per-tenant isolation policies on
--   all tables. Creates indexes for efficient lookup patterns (inspector packages,
--   upload deduplication, cursor tracking).
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, schemas, indexes) or guarded (policies via DROP-then-CREATE),
--   so it can be re-applied safely.
--
-- Requirements: 6.1 (Sync Package Generation), 6.2 (Idempotent Sync Upload),
--               6.8 (Partial Resume via Cursors)
--
-- Row-level security (RLS):
--   Every tenant-scoped table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY.
--   The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC yields
--   NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP POLICY IF EXISTS tenant_isolation ON sync.sync_cursors;
--   DROP POLICY IF EXISTS tenant_isolation ON sync.sync_uploads;
--   DROP POLICY IF EXISTS tenant_isolation ON sync.sync_packages;
--   DROP INDEX IF EXISTS sync.idx_sync_cursors_tenant_inspector_device;
--   DROP INDEX IF EXISTS sync.idx_sync_uploads_tenant_inspector;
--   DROP INDEX IF EXISTS sync.idx_sync_packages_tenant_inspector;
--   DROP INDEX IF EXISTS sync.idx_sync_packages_tenant_status;
--   DROP TABLE IF EXISTS sync.sync_cursors;
--   DROP TABLE IF EXISTS sync.sync_uploads;
--   DROP TABLE IF EXISTS sync.sync_packages;
--   DROP SCHEMA IF EXISTS sync;
--
-- Affected services: inspection-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS sync;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLES (sync schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Sync Packages ─────────────────────────────────────────────────────────────
-- Offline data bundles containing checklists, entity data, and map tiles for
-- field use. Status tracks generation lifecycle: generating → ready → expired.

CREATE TABLE IF NOT EXISTS sync.sync_packages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    inspector_id    UUID         NOT NULL,
    inspection_ids  JSONB        NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'generating'
                    CHECK (status IN ('generating', 'ready', 'expired')),
    checksum        TEXT,
    s3_key          TEXT,
    size_bytes      INTEGER,
    generated_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      UUID         NOT NULL,
    version         INTEGER      NOT NULL DEFAULT 1
);

-- ── Sync Uploads ──────────────────────────────────────────────────────────────
-- Queued offline inspection results submitted by field devices. Each upload is
-- uniquely identified by (tenant, inspection, device, sequence_number) for
-- idempotent processing and partial resume support.

CREATE TABLE IF NOT EXISTS sync.sync_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    inspector_id    UUID         NOT NULL,
    inspection_id   UUID         NOT NULL,
    device_id       TEXT         NOT NULL,
    sequence_number INTEGER      NOT NULL,
    payload         JSONB        NOT NULL,
    sha256_hash     TEXT,
    network_state   VARCHAR(16)  NOT NULL DEFAULT 'offline'
                    CHECK (network_state IN ('online', 'offline')),
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processed', 'skipped')),
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      UUID         NOT NULL,
    version         INTEGER      NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, inspection_id, device_id, sequence_number)
);

-- ── Sync Cursors ──────────────────────────────────────────────────────────────
-- Tracks the last acknowledged sequence number per device+inspection for partial
-- resume. On interrupted upload, clients resume from lastAckedSeq + 1.

CREATE TABLE IF NOT EXISTS sync.sync_cursors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    inspector_id    UUID         NOT NULL,
    inspection_id   UUID         NOT NULL,
    device_id       TEXT         NOT NULL,
    last_acked_seq  INTEGER      NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    version         INTEGER      NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy on every table.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policies are dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE sync.sync_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.sync_packages FORCE  ROW LEVEL SECURITY;
ALTER TABLE sync.sync_uploads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.sync_uploads  FORCE  ROW LEVEL SECURITY;
ALTER TABLE sync.sync_cursors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.sync_cursors  FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON sync.sync_packages;
CREATE POLICY tenant_isolation ON sync.sync_packages
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON sync.sync_uploads;
CREATE POLICY tenant_isolation ON sync.sync_uploads
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON sync.sync_cursors;
CREATE POLICY tenant_isolation ON sync.sync_cursors
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Sync Packages: lookup by inspector within a tenant
CREATE INDEX IF NOT EXISTS idx_sync_packages_tenant_inspector
    ON sync.sync_packages (tenant_id, inspector_id);

-- Sync Packages: filter by status within a tenant (e.g., find expired for cleanup)
CREATE INDEX IF NOT EXISTS idx_sync_packages_tenant_status
    ON sync.sync_packages (tenant_id, status);

-- Sync Uploads: lookup uploads by inspector within a tenant
CREATE INDEX IF NOT EXISTS idx_sync_uploads_tenant_inspector
    ON sync.sync_uploads (tenant_id, inspector_id);

-- Sync Uploads: lookup by inspection for processing
CREATE INDEX IF NOT EXISTS idx_sync_uploads_tenant_inspection
    ON sync.sync_uploads (tenant_id, inspection_id);

-- Sync Cursors: lookup cursor by inspector, inspection, and device
CREATE INDEX IF NOT EXISTS idx_sync_cursors_tenant_inspector_device
    ON sync.sync_cursors (tenant_id, inspector_id, inspection_id, device_id);
