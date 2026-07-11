-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0012_court_parcel.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Adds the case↔parcel linkage table for the REVENUE-court domain: revenue and
--   land courts adjudicate over specific parcels of land identified by survey /
--   khasra numbers. This table attaches the disputed parcel(s) to a case and
--   powers the reverse lookup "which cases involve this survey number". ONE
--   table: `court.case_parcels`.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes) or guarded (policy via DROP-then-CREATE), so it
--   can be re-applied safely.
--
-- Measurement discipline (no floats):
--   court.case_parcels.area_sqm holds the parcel area as an INTEGER number of
--   square metres (BIGINT), consistent with the suite's money/no-float rule. The
--   app layer coerces user input (which may be given in acres/hectares/bigha) to
--   whole square metres before persistence; the DB never stores fractional area.
--
-- Row-level security (RLS) — the CORRECT form (mirrors 0001_court_core.sql /
--   0006_court_evidence.sql):
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
--   DROP TABLE IF EXISTS court.case_parcels;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Case↔parcel linkage. A case may involve one or more parcels; each row records
-- the parcel's revenue identifiers (survey/khasra/khata), its administrative
-- location (village/tehsil/district), the disputed subject_type ('land' by
-- default), an optional area in whole square metres, and an optional opaque
-- ownership reference. `active` supports soft-detachment of a parcel from a case
-- without a destructive delete.
CREATE TABLE IF NOT EXISTS court.case_parcels (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    case_id       UUID NOT NULL,
    survey_number VARCHAR(64)  NOT NULL,
    khasra_number VARCHAR(64),
    khata_number  VARCHAR(64),
    village       VARCHAR(120) NOT NULL,
    tehsil        VARCHAR(120),
    district      VARCHAR(120),
    area_sqm      BIGINT,
    subject_type  VARCHAR(32)  NOT NULL DEFAULT 'land',
    ownership_ref VARCHAR(120),
    remarks       TEXT,
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    version       INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policy is dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.case_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.case_parcels FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.case_parcels;
CREATE POLICY tenant_isolation ON court.case_parcels
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): this table is brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
--     - (tenant_id, case_id):       list a case's parcels.
--     - (tenant_id, survey_number): reverse lookup "which cases involve this survey?".
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_case_parcels_tenant_case
    ON court.case_parcels(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_case_parcels_tenant_survey
    ON court.case_parcels(tenant_id, survey_number);
