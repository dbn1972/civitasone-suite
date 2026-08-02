-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0017_certified_copy_payment_proof.sql
-- Service:   court-service — DB civitas_court
--
-- Purpose:
--   §30 integrity gap: a certified copy could be marked fee_paid with NO proof
--   that money actually changed hands, and with no way to verify the receipted
--   amount matches the server-computed fee. Adds two columns to
--   court.certified_copies so the fee_paid transition carries verifiable
--   payment evidence:
--     payment_ref    — the payment gateway / treasury challan reference.
--     receipt_minor  — the RECEIPTED amount in BigInt PAISE. The consumer
--                      (modules/certified-copy/consumer.ts) asserts this equals
--                      the row's existing fee_minor before allowing the
--                      requested → fee_paid transition (domain.ts
--                      assertReceiptMatchesFee) — a receipted amount that
--                      doesn't match the server-authoritative fee is rejected,
--                      not silently accepted.
--
--   Additive + idempotent (ADD COLUMN IF NOT EXISTS): safe to re-apply.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per
--           Migration Safety Rules; no automatic down-migration is provided):
--   ALTER TABLE court.certified_copies DROP COLUMN IF EXISTS payment_ref;
--   ALTER TABLE court.certified_copies DROP COLUMN IF EXISTS receipt_minor;
--
-- Affected services: court-service only.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

ALTER TABLE court.certified_copies ADD COLUMN IF NOT EXISTS payment_ref   VARCHAR(64);
ALTER TABLE court.certified_copies ADD COLUMN IF NOT EXISTS receipt_minor BIGINT;
