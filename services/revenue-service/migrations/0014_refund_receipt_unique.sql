-- revenue-service migration 0014 — one live refund per receipt (GAP-REVENUE-REFUNDS-02)
-- Applied AFTER 0013_bill_assessment_unique.sql
-- Rollback: DROP INDEX IF EXISTS collection.uq_refunds_tenant_receipt_live;
--
-- GAP-REVENUE-REFUNDS-02: refundCreate checked "is there already a non-rejected
-- refund for this receipt?" with a plain SELECT and then INSERTed. Two
-- concurrent consumers can both pass the SELECT and both insert, producing two
-- live refunds (a duplicate money-out) for the same receipt.
--
-- Fix: a PARTIAL UNIQUE index on (tenant_id, receipt_id) WHERE status <>
-- 'rejected'. A rejected refund does not block re-raising (matches the
-- consumer's rule); pending / approved / processed refunds are mutually
-- exclusive per receipt. The consumer keeps its SELECT as the friendly no-op
-- path; this index is the race-free backstop (the losing insert raises 23505,
-- the message is retried, and the retry hits the SELECT no-op).
--
-- Pre-existing-duplicate safety: if a receipt already carries two live refunds
-- the CREATE UNIQUE INDEX fails LOUDLY. That is a duplicate-payout incident a
-- human must resolve (which refund stands), not something to silently delete
-- under FORCE RLS. Same stance as 0012/0013.

SET lock_timeout = '5s';

DO $$ BEGIN
  CREATE UNIQUE INDEX uq_refunds_tenant_receipt_live
    ON collection.refunds (tenant_id, receipt_id)
    WHERE status <> 'rejected';
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
