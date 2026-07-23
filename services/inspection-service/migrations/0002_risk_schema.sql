-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0002_risk_schema.sql
-- Service:   inspection-service — DB civitas_inspection
--
-- Purpose:
--   Creates the `risk` PostgreSQL schema with two domain tables:
--   - risk.risk_models: configurable risk scoring models with weighted factors
--   - risk.risk_scores: computed risk scores per entity (property/establishment)
--
--   Enables (and FORCEs) row-level security with per-tenant isolation policies on
--   both tables. Creates a composite index on risk_scores (tenant_id, entity_id)
--   for efficient entity-based lookups.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, schemas, indexes) or guarded (policies via DROP-then-CREATE),
--   so it can be re-applied safely.
--
-- Requirements: 3.1 (Risk Model Configuration), 3.2 (Risk Score Computation),
--               3.3 (Risk-Based Prioritization)
--
-- Row-level security (RLS):
--   Every tenant-scoped table has BOTH `ENABLE` AND `FORCE` ROW LEVEL SECURITY.
--   The tenant_isolation policy uses the missing-ok GUC form
--   `NULLIF(current_setting('app.tenant_id', true), '')::uuid` so an UNSET GUC yields
--   NULL (rows invisible — fail-closed) instead of raising.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP SCHEMA IF EXISTS risk CASCADE;
--
-- Affected services: inspection-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS risk;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLES (risk schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Risk Models ───────────────────────────────────────────────────────────────
-- Configurable scoring models with weighted factors.
-- factors JSON shape: { name: string; weight: number; scoringFunction: string; dataSource: string }[]
-- Invariant: sum(weight) === 1.0 (±0.001) — enforced at application layer.

CREATE TABLE IF NOT EXISTS risk.risk_models (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    factors     JSONB NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID NOT NULL,
    updated_by  UUID NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1
);

-- ── Risk Scores ───────────────────────────────────────────────────────────────
-- Computed risk scores per entity, linked to a model.
-- score: integer 0–100 (enforced via CHECK constraint).
-- factor_breakdown JSON shape: { factorName: string; rawScore: number; weightedScore: number }[]

CREATE TABLE IF NOT EXISTS risk.risk_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    entity_id       UUID NOT NULL,
    model_id        UUID NOT NULL REFERENCES risk.risk_models(id),
    score           INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    factor_breakdown JSONB NOT NULL,
    previous_score  INTEGER,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy on every table.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policies are dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE risk.risk_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk.risk_models FORCE  ROW LEVEL SECURITY;
ALTER TABLE risk.risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk.risk_scores FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON risk.risk_models;
CREATE POLICY tenant_isolation ON risk.risk_models
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON risk.risk_scores;
CREATE POLICY tenant_isolation ON risk.risk_scores
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): these tables are brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Risk Models
CREATE INDEX IF NOT EXISTS idx_risk_models_tenant
    ON risk.risk_models(tenant_id);

CREATE INDEX IF NOT EXISTS idx_risk_models_tenant_active
    ON risk.risk_models(tenant_id, is_active);

-- Risk Scores
CREATE INDEX IF NOT EXISTS idx_risk_scores_tenant
    ON risk.risk_scores(tenant_id);

-- Primary lookup index: find all scores for a given entity within a tenant.
CREATE INDEX IF NOT EXISTS idx_risk_scores_tenant_entity
    ON risk.risk_scores(tenant_id, entity_id);

CREATE INDEX IF NOT EXISTS idx_risk_scores_model
    ON risk.risk_scores(model_id);

CREATE INDEX IF NOT EXISTS idx_risk_scores_computed_at
    ON risk.risk_scores(tenant_id, computed_at);
