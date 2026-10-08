-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0020_court_order_dsc_verification.sql
-- Service:   court-service — DB civitas_court
--
-- Purpose:
--   GAP-COURT-ORDERS-02 — judicial order issuance is a human, DSC-signed act.
--   Until now the detached PKCS#7 signature was stored verbatim in
--   court.orders.dsc_signature with NO server-side cryptographic verification;
--   the web side only did a structural (base64/PEM) sanity check. This
--   migration records the OUTCOME of the new server-side verification so an
--   issued order carries durable, auditable proof of who signed it and whether
--   the signer chained to a configured trust store:
--     • dsc_signer_cn      — the signer certificate Common Name (e.g. the
--                            judge/registrar as named in the DSC).
--     • dsc_signer_serial  — the signer certificate serial number (hex).
--     • dsc_verified_at    — the instant the signature was verified at issue.
--     • dsc_chain_trusted  — TRUE only when the signer chain verified against a
--                            configured trust store (COURT_DSC_TRUST_STORE_PEM);
--                            FALSE when no trust store is configured (fail-closed)
--                            or the chain did not verify. Defaults to FALSE so
--                            every pre-existing issued order is treated as
--                            not-chain-verified rather than silently "trusted".
--
--   Additive + idempotent (ADD COLUMN IF NOT EXISTS): safe to re-apply. No
--   backfill of real values is possible for historical orders (their original
--   signatures were never verified); dsc_chain_trusted defaults to FALSE and the
--   other columns remain NULL, which is the correct honest state.
--
-- Row-level security (RLS):
--   court.orders already has ENABLE + FORCE ROW LEVEL SECURITY + the
--   tenant_isolation policy (0001_court_core.sql). ADD COLUMN leaves those
--   intact, so the new columns are tenant-isolated automatically.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per
--           Migration Safety Rules; no automatic down-migration is provided):
--   ALTER TABLE court.orders
--     DROP COLUMN IF EXISTS dsc_signer_cn,
--     DROP COLUMN IF EXISTS dsc_signer_serial,
--     DROP COLUMN IF EXISTS dsc_verified_at,
--     DROP COLUMN IF EXISTS dsc_chain_trusted;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

ALTER TABLE court.orders
    ADD COLUMN IF NOT EXISTS dsc_signer_cn     VARCHAR(255),
    ADD COLUMN IF NOT EXISTS dsc_signer_serial VARCHAR(128),
    ADD COLUMN IF NOT EXISTS dsc_verified_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dsc_chain_trusted BOOLEAN NOT NULL DEFAULT FALSE;
