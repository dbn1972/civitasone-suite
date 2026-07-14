-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0010_visitor_config.sql
-- Service:   visitor-service (gateway /api/v1/visitor) — DB civitas_visitor
--
-- Purpose:
--   Adds the config/metadata keystone for visitor-service ("nothing hardcoded").
--   ONE table: `visitor.config_entries`. A tenant-scoped, versioned, namespaced
--   key/value store: (namespace, config_key) → jsonb value, where namespace is
--   the config domain (visitor_policy for scalar operational knobs;
--   visitor_approval for the effectiveAllowed auto-approve visitor-category set).
--   OTHER modules READ this table at runtime to drive behavior from tenant
--   configuration instead of hardcoded thresholds/rules — so two government
--   offices can run different policies (retention window, auto-reject/no-show
--   timers, pass-validity caps, approval categories, overstay grace, anti-passback)
--   without a code change.
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
-- Row-level security (RLS) — the CORRECT form (mirrors 0001..0008 visitor tables):
--   The table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY, so even the
--   table-owner role (visitor_svc) is subject to the policy (ENABLE alone lets the
--   owner bypass RLS). The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC
--   yields NULL (rows invisible — fail-closed) instead of raising. USING also
--   governs INSERT/UPDATE WITH CHECK (Postgres reuses the USING expression), so
--   writes cannot cross tenants. The BYPASSRLS `visitor_scanner` role (0009) reads
--   config cross-tenant for the maintenance workers.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval; no automatic
--           down-migration is provided):
--   DROP TABLE IF EXISTS visitor.config_entries;
--
-- Affected services: visitor-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE (visitor schema)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS visitor.config_entries (
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
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + fail-closed policy.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE visitor.config_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor.config_entries FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON visitor.config_entries;
CREATE POLICY tenant_isolation ON visitor.config_entries
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

-- A (namespace, config_key) is SINGULAR per tenant — enforces upsert-by-key and
-- backs the deterministic id derivation in domain.ts (deriveConfigId).
CREATE UNIQUE INDEX IF NOT EXISTS uq_visitor_config_tenant_namespace_key
    ON visitor.config_entries(tenant_id, namespace, config_key);

-- Read path: "list the active entries for a namespace" (the module read pattern)
-- and the cross-tenant override load (loadNamespaceOverrides) used by workers.
CREATE INDEX IF NOT EXISTS idx_visitor_config_tenant_namespace_active
    ON visitor.config_entries(tenant_id, namespace, active);

CREATE INDEX IF NOT EXISTS idx_visitor_config_namespace_active
    ON visitor.config_entries(namespace, active);

-- ═══════════════════════════════════════════════════════════════════════════════
-- GRANTS — the BYPASSRLS maintenance scanner role reads config cross-tenant.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visitor_scanner') THEN
    GRANT SELECT ON visitor.config_entries TO visitor_scanner;
  END IF;
END $$;
