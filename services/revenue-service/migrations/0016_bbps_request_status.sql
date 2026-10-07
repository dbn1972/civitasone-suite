-- revenue-service migration 0016 — BBPS request status read model (GAP-REVENUE-BBPS-02)
-- Applied AFTER 0015_adjustment_maker_checker.sql
-- Rollback:
--   DROP INDEX IF EXISTS bbps.idx_bbps_transactions_message_id;
--   ALTER TABLE bbps.bbps_transactions
--     DROP COLUMN IF EXISTS message_id,
--     DROP COLUMN IF EXISTS failure_reason,
--     DROP COLUMN IF EXISTS request_type;
--
-- GAP-REVENUE-BBPS-02 (money: unknown payment outcome): the BBPS fetch-bill /
-- pay-bill routes are fire-and-forget — the web screen only gets the queue
-- acknowledgement's messageId and tells the officer to "check Bills/Receipts
-- later". There is no way to see whether a request succeeded, failed, or is
-- still pending, so a payment that fails in the biller adapter is silent.
--
-- Fix: make bbps.bbps_transactions a status read model keyed by the SAME
-- messageId the route returns to the client, so a new
-- GET /v1/revenue/bbps/requests/:messageId can report status (pending |
-- success | failed), the resulting receiptId on success, and a human failure
-- reason on failure. Additive, idempotent columns:
--   message_id     uuid     the queue messageId returned to the client (ack)
--   failure_reason text     human reason when status='failed' (never raw PII)
--   request_type   varchar  'fetch' | 'pay' so the queue can list both kinds
--
-- No backfill of a value is required: pre-existing rows (if any) simply have a
-- null message_id and are not addressable by the new endpoint, which is
-- correct — they predate the ack-correlation contract. New rows always carry
-- message_id (see consumer.ts).
--
-- A non-unique index on (tenant_id, message_id) backs the point lookup. It is
-- NOT unique: a single pay-bill messageId maps to exactly one row, but keeping
-- it non-unique avoids a migration failure on any legacy null/duplicate and is
-- sufficient for the lookup (the consumer writes exactly one row per messageId).
-- ADD COLUMN preserves existing grants, so no new GRANT is needed.

SET lock_timeout = '5s';

ALTER TABLE bbps.bbps_transactions
  ADD COLUMN IF NOT EXISTS message_id     uuid,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS request_type   varchar(16);

DO $$ BEGIN
  CREATE INDEX idx_bbps_transactions_message_id
    ON bbps.bbps_transactions (tenant_id, message_id)
    WHERE message_id IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
