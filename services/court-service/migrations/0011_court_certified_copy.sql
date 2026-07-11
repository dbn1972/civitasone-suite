-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0011_court_certified_copy.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Adds the certified-copy table for Court spec §30 (certified copies). A citizen
--   applies for a certified copy of an order / judgment / case document, pays a
--   SERVER-AUTHORITATIVE fee, and the registry tracks issuance:
--       requested → fee_paid → prepared → issued
--   with a reject path from any pre-terminal state. ONE table: `court.certified_copies`.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object is created with
--   IF NOT EXISTS (tables, indexes) or guarded (policy via DROP-then-CREATE), so it
--   can be re-applied safely.
--
-- PII at rest (DPDP Act 2023, Req 15.3):
--   applicant_name_enc holds the AES-256-GCM ciphertext of the applicant's name,
--   written through the app-layer encryptedText() Drizzle type (like
--   case_parties.name_enc). The DB never sees cleartext; the applicant name is
--   NEVER emitted in an event or audit payload.
--
-- Money (integrity):
--   fee_minor is BigInt PAISE (minor units). The fee is SERVER-AUTHORITATIVE,
--   resolved by the consumer from the tenant `copy_fee` config namespace; a
--   client-supplied hint can never lower/tamper it when a schedule is configured.
--   fee_source records whether the effective fee came from config or the client hint.
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
--   DROP TABLE IF EXISTS court.certified_copies;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE (court schema)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Certified copies (§30): status lifecycle
--   requested → {fee_paid | rejected}
--   fee_paid  → {prepared | rejected}
--   prepared  → {issued   | rejected}
-- issued and rejected are terminal. issued_at / issued_by are stamped on issuance.
CREATE TABLE IF NOT EXISTS court.certified_copies (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL,
    case_id            UUID NOT NULL,
    order_id           UUID,
    document_ref       VARCHAR(512),
    applicant_name_enc TEXT,
    copies_count       INTEGER NOT NULL DEFAULT 1,
    urgent             BOOLEAN NOT NULL DEFAULT false,
    fee_minor          BIGINT NOT NULL DEFAULT 0,
    fee_source         VARCHAR(8),
    status             VARCHAR(16) NOT NULL DEFAULT 'requested',
    requested_by       UUID,
    issued_by          UUID,
    issued_at          TIMESTAMPTZ,
    delivery_mode      VARCHAR(24),
    remarks            TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID,
    updated_by         UUID,
    version            INTEGER NOT NULL DEFAULT 1
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY (tenant isolation) — ENABLE + FORCE + policy.
--   FORCE ensures even the table owner is subject to the policy. The policy uses
--   the missing-ok GUC form so an unset app.tenant_id yields NULL → no rows
--   (fail-closed). Policy is dropped-then-created for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE court.certified_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE court.certified_copies FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON court.certified_copies;
CREATE POLICY tenant_isolation ON court.certified_copies
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Plain CREATE INDEX (not CONCURRENTLY): this table is brand-new and empty at
--   migration time, so index builds are instant and non-blocking. All IF NOT EXISTS
--   for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_certified_copies_tenant_case
    ON court.certified_copies(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_certified_copies_tenant_status
    ON court.certified_copies(tenant_id, status);
