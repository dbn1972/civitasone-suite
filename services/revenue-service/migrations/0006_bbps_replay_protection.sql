-- revenue-service migration 0006 — BBPS replay/duplicate protection (SEC-001)
-- Applied AFTER 0005_trade_licenses_waivers.sql
-- Rollback: ALTER TABLE bbps.bbps_transactions DROP CONSTRAINT uq_bbps_transactions_tenant_txn;
--
-- SEC-001 (PR #1096): POST /v1/revenue/bbps/pay-bill is now role-gated
-- (requireRole(ctx, REVENUE_ROLES)), but a valid (role-holding) caller could
-- still replay the exact same request body repeatedly — the outbox's
-- markProcessed idempotency key is the messageId, which
-- shared/publish.ts#publishCommand mints fresh (randomUUID()) on every
-- publish, so it does not catch a replayed *business* payload
-- (assesseeIdentifier/amountMinor/bbpsTxnId) at all. Each replay would write
-- a fresh receipt + DCB collection entry + bbps_transactions row + GL-bound
-- receiptCaptured event, bounded only by validateBbpsPayment's
-- outstanding-balance check paying down across replays, not by any check
-- that this exact bbpsTxnId was already processed.
--
-- Fix: a per-tenant UNIQUE constraint on (tenant_id, bbps_txn_id), matching
-- this codebase's established tenant-scoped-uniqueness convention (see e.g.
-- asset-service/migrations/0018_fleet_devices_rls.sql's
-- uq_fleet_devices_tenant_imei, ai-agent-service's
-- uq_agent_authoring_tenant_name). Scoped per-tenant, not globally, because
-- bbpsTxnId is a biller-assigned identifier per BBPS integration; two
-- different tenants (different ULB/municipality BBPS billers) transacting
-- with coincidentally identical bbpsTxnId values is not a same-transaction
-- replay and must not be rejected as one — RLS tenant isolation on this
-- table already assumes tenant_id-scoped uniqueness elsewhere in this
-- codebase, this follows the same rule.
--
-- consumer.ts uses this constraint via `.onConflictDoNothing()` on the
-- bbps_transactions insert (atomic claim, same race-free pattern as
-- @civitasone/outbox's markProcessed: ON CONFLICT DO NOTHING + RETURNING,
-- empty result means "already processed, no-op" rather than raising).
--
-- Pre-existing-duplicate safety: if any (tenant_id, bbps_txn_id) duplicates
-- already exist (there should not be any — this is a new table with no
-- known duplicate-writing path prior to this fix — but a migration must
-- not fail outright against real data), keep only the earliest row per key
-- before adding the constraint. This does not delete any receipt/DCB/GL
-- rows those duplicate bbps_transactions rows point to; it only prevents a
-- constraint-creation failure. In practice this DELETE affects 0 rows in
-- every environment observed.

SET lock_timeout = '5s';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, bbps_txn_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM bbps.bbps_transactions
)
DELETE FROM bbps.bbps_transactions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE bbps.bbps_transactions
  ADD CONSTRAINT uq_bbps_transactions_tenant_txn UNIQUE (tenant_id, bbps_txn_id);
