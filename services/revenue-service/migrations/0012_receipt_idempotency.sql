-- revenue-service migration 0012 — receipt UTR idempotency (GAP-REVENUE-RECEIPTS-01)
-- Applied AFTER 0011_assessee_identifier_unique.sql
-- Rollback: DROP INDEX IF EXISTS collection.uq_receipts_tenant_reference;
--
-- GAP-REVENUE-RECEIPTS-01: POST /v1/revenue/receipts is a money-IN mutation
-- with no de-duplication. The outbox's markProcessed idempotency key is the
-- messageId, which shared/publish.ts#publishCommand mints fresh
-- (randomUUID()) per publish, so a client that retries after a network
-- timeout (a fresh request → fresh messageId) records the SAME UTR twice:
-- two receipts, two DCB collection entries, two GL-bound receiptCaptured
-- events → the payment is double-credited and bank reconciliation breaks.
--
-- Fix: a per-tenant UNIQUE index on (tenant_id, reference) — the reference
-- column holds the UTR / instrument transaction ref. Scoped per-tenant (not
-- global), matching this codebase's tenant-scoped-uniqueness convention (see
-- 0006_bbps_replay_protection.sql's uq_bbps_transactions_tenant_txn): two
-- different ULBs with coincidentally identical bank references are not a
-- same-payment replay. PARTIAL (WHERE reference IS NOT NULL AND reference <>
-- '') because the column is nullable and a few legacy/edge receipts may carry
-- no reference; those are not constrained (a null UTR cannot be de-duplicated
-- and must not collapse unrelated receipts into one).
--
-- consumer.ts claims the key with ON CONFLICT DO NOTHING + RETURNING: an empty
-- result means "this UTR was already recorded for this tenant" and the handler
-- no-ops (does NOT write a second DCB entry or event), so a retry is a safe
-- idempotent no-op rather than a double credit.
--
-- Pre-existing-duplicate safety: a CREATE UNIQUE INDEX would fail if real
-- duplicate (tenant_id, reference) rows already exist. There is no known
-- duplicate-writing path before this fix, but a migration must not fail
-- outright against real data, so build the index CONCURRENTLY-safe by first
-- proving there are no blocking duplicates is not possible in a single
-- transactional migration; instead we create a NON-unique index first is also
-- not what we want. We therefore create the unique index directly and rely on
-- the DO/EXCEPTION guard to stay idempotent on re-run; if a genuine duplicate
-- exists the migration will error loudly (correct: a pre-existing double
-- credit is a data-integrity incident a human must resolve, not silently
-- de-duplicate here).

SET lock_timeout = '5s';

DO $$ BEGIN
  CREATE UNIQUE INDEX uq_receipts_tenant_reference
    ON collection.receipts (tenant_id, reference)
    WHERE reference IS NOT NULL AND reference <> '';
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
