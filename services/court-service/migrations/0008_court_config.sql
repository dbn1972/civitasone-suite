-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0008_court_config.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Adds the config/metadata keystone for Court spec §47 ("nothing hardcoded").
--   ONE table: `court.config_entries`. A tenant-scoped, versioned, namespaced
--   key/value store: (namespace, config_key) → jsonb value, where namespace is
--   the config domain (e.g. court_type, case_type, order_type, hearing_purpose,
--   fee_schedule, sla_timer, notice_template). OTHER modules READ this table at
--   runtime to drive behavior from tenant configuration instead of hardcoded
--   enums/rules — it is the foundation of the platform's config/metadata engine.
--
--   Each (tenant, namespace, config_key) row is SINGULAR (a UNIQUE index) and
--   carries the standard optimistic-lock `version` column plus an `active` soft-
--   deactivation flag, so config is versioned and can be retired without a hard
--   delete (auditability of the metadata that governs the platform).
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes) or guarded (policy via DROP-then-CREATE), so
--   it can be re-applied safely.
--
-- Row-level security (RLS) — the CORRECT form (mirrors 0001_court_core.sql):
--   The table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role is subject to the policy (ENABLE alone lets the owner bypass
--   RLS). The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC
--   yields NULL (rows invisible — fail-closed) instead of raising. USING also
--   governs INSERT/UPDATE WITH CHECK (Postgres reuses the USING expression), so
--   writes cannot cross tenants.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS court.config_entries;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Config entries (§47): a (namespace, config_key) → jsonb value store per tenant.
--   namespace     — the config domain (court_type, case_type, order_type, …).
--   config_key    — the key within that namespace (e.g. a specific enum member).
--   value         — arbitrary JSON payload driving module behavior.
--   active        — soft-deactivation flag; a retired key stays for audit.
--   effective_from / effective_to — optional validity window for the entry.
--   version       — standard optimistic-lock token (bumped on every update).
CREATE TABLE IF NOT EXISTS court.config_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    namespace      VARCHAR(64) NOT NULL,
    config_key     VARCHAR(128) NOT NULL,
    value          JSONB NOT NULL,
    label          TEXT,
    description    TEXT,
    active         BOOLEAN NOT NULL DEFAULT true,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    effective_from DATE,
    effective_to   DATE,
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

ALTER TABLE court.config_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.config_entries FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.config_entries;
CREATE POLICY tenant_isolation ON court.config_entries
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): this table is brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT
--   EXISTS for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- A (namespace, config_key) is SINGULAR per tenant — enforces upsert-by-key and
-- backs the deterministic id derivation in domain.ts (deriveConfigId).
CREATE UNIQUE INDEX IF NOT EXISTS uq_config_tenant_namespace_key
    ON court.config_entries(tenant_id, namespace, config_key);

-- Read path: "list the active entries for a namespace" (the module read pattern).
CREATE INDEX IF NOT EXISTS idx_config_tenant_namespace_active
    ON court.config_entries(tenant_id, namespace, active);
