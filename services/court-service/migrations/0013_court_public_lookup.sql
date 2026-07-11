-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0013_court_public_lookup.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Backs the UNAUTHENTICATED, OTP-gated public case-status lookup (§ public-lookup;
--   analogous to eCourts but OTP-gated for privacy). Adds two tables to the `court`
--   schema:
--     1. court.public_establishments — a public directory mapping an establishment
--        code / CNR prefix / public slug to the OWNING tenant, so an anonymous caller
--        can be resolved to the correct tenant SERVER-SIDE before any tenant-scoped
--        read runs.
--     2. court.otp_challenges — the pre-auth OTP challenge registry (rate-limit,
--        attempt-cap, single-use, expiry). Mobile numbers are PII and are stored ONLY
--        as a peppered SHA-256 hash; the OTP is stored ONLY as a salted SHA-256 hash.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes), so it can be re-applied safely.
--
-- WHY NO ROW-LEVEL SECURITY on these two tables (deliberate — mirrors _outbox/_inbox):
--   Both tables are PRE-AUTH / CROSS-TENANT REGISTRIES that MUST be readable BEFORE a
--   tenant is known. RLS on the court schema is fail-closed: an unset `app.tenant_id`
--   GUC yields NULL → zero rows. But the entire point of these tables is to run WITHOUT
--   a tenant GUC:
--     • public_establishments is the mechanism BY WHICH we resolve the tenant from a
--       CNR prefix / slug — if it were tenant-scoped it could never be read pre-auth.
--     • otp_challenges is keyed on a mobile HASH, not a tenant; an anonymous caller has
--       no tenant to scope by when requesting or verifying an OTP.
--   So, exactly like `_outbox.messages` / `_inbox.processed` in 0001 (which the relay
--   scans across tenants), these two tables intentionally have NO RLS. Tenant isolation
--   for the DOWNSTREAM case read is still enforced: the route resolves the tenant from
--   public_establishments, then reads court.cases (which HAS RLS) under
--   runWithTenant(resolvedTenantId, …) so the RLS policy scopes that read.
--
--   NOTE: public_establishments.tenant_id is admin-published config (court establishment
--   registry), NOT end-user PII, and is NEVER exposed by the public directory endpoint
--   (the repo projects only court_name / public_slug / establishment_code).
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   DROP TABLE IF EXISTS court.otp_challenges;
--   DROP TABLE IF EXISTS court.public_establishments;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any DDL.
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS court;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ── Public establishment directory (cross-tenant, NO RLS — see header) ──────────
CREATE TABLE IF NOT EXISTS court.public_establishments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    establishment_code  VARCHAR(32) NOT NULL,
    cnr_prefix          VARCHAR(8)  NOT NULL,
    tenant_id           UUID        NOT NULL,
    court_name          TEXT        NOT NULL,
    public_slug         VARCHAR(64) NOT NULL,
    active              BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    CONSTRAINT uq_public_establishments_code UNIQUE (establishment_code),
    CONSTRAINT uq_public_establishments_slug UNIQUE (public_slug)
);

-- Tenant resolution BY CNR prefix (public case-status lookup hot path).
CREATE INDEX IF NOT EXISTS idx_public_establishments_cnr_prefix
    ON court.public_establishments (cnr_prefix);

-- Public directory listing filters on active.
CREATE INDEX IF NOT EXISTS idx_public_establishments_active
    ON court.public_establishments (active);

-- ── OTP challenge registry (pre-auth, keyed on mobile HASH, NO RLS — see header) ─
CREATE TABLE IF NOT EXISTS court.otp_challenges (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile_hash   VARCHAR(64) NOT NULL,               -- SHA-256(pepper:normalizedMobile); PII never stored raw
    otp_hash      VARCHAR(64) NOT NULL,               -- SHA-256(challengeId:otp); OTP never stored raw
    purpose       VARCHAR(24) NOT NULL DEFAULT 'case_status',
    attempts      INTEGER     NOT NULL DEFAULT 0,
    max_attempts  INTEGER     NOT NULL DEFAULT 5,
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,                         -- single-use: set once on successful verify
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-mobile rate limit: count recent challenges for a mobile_hash within a window.
CREATE INDEX IF NOT EXISTS idx_otp_challenges_mobile_created
    ON court.otp_challenges (mobile_hash, created_at);

-- Scheduled cleanup of expired challenges.
CREATE INDEX IF NOT EXISTS idx_otp_challenges_expires
    ON court.otp_challenges (expires_at);
