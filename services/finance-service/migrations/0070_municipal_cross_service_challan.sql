-- Migration 0070: municipal Sec5 cross-service challan support.
-- Additive + idempotent only. Safe to re-run.
--
-- Ported/fixed alongside packages/events/src/municipal-cross.ts (see that
-- file's header for the three bugs fixed vs. the held branch source):
--
--   1. receiptHeadId is no longer a fabricated placeholder UUID from the
--      producer. finance-service's challanCreate consumer now resolves a
--      receiptHeadCode to a real budget.finance_heads.id per tenant
--      (headIdByCode), hard-erroring if absent — same pattern as
--      BANK_CODE / DEPOSIT_LIABILITY_CODE in migration 0015. This migration
--      seeds that control head (code 0075) for the platform default tenant,
--      mirroring 0015's seed exactly. A real production tenant needs the
--      same code seeded during its own provisioning (no new provisioning
--      mechanism introduced — this is the existing, established pattern).
--   2. (amountMinor precision fix is TS-only — @civitasone/schemas money
--      codec — no schema change needed.)
--   3. source_service/source_ref: back-link from the challan row to the
--      originating municipal application, so "pay the fee for this trade
--      application" can be joined in either direction. Mirrors the
--      source_service/source_ref_id convention already used by
--      workflow-service (workflow.cases) and admin-service
--      (integration_ops.dead_letter).

-- ============================================================
-- Fix (3): cross-service back-link columns on the challan row.
-- ============================================================
ALTER TABLE treasury.finance_challans
  ADD COLUMN IF NOT EXISTS source_service varchar(64),
  ADD COLUMN IF NOT EXISTS source_ref     text;

CREATE INDEX IF NOT EXISTS idx_fchallans_source
  ON treasury.finance_challans (tenant_id, source_service, source_ref)
  WHERE source_service IS NOT NULL;

-- ============================================================
-- Fix (1): municipal-fee receipt control head (per default tenant,
-- idempotent). Production tenants get it on first use via the same code
-- (consumer resolves by code and hard-errors if absent, mirroring AP /
-- migration 0015's deposit-liability/forfeiture-income heads).
--   0075  Municipal Licence & Permit Fees (Non-Tax Revenue)
-- Code must match MUNICIPAL_FEE_RECEIPT_HEAD_CODE in
-- packages/events/src/municipal-cross.ts.
-- ============================================================
-- RLS on budget.finance_heads (migrations 0019/0035) is FORCE'd even for
-- the owning role, and its policy's USING clause doubles as the INSERT
-- WITH CHECK (no explicit WITH CHECK given) — so this session must claim
-- the target tenant via the same app.tenant_id GUC current_tenant_id()
-- reads (migration 0058), or the INSERT is silently rejected as a policy
-- violation.
--
-- PERF-001 fix-up: this used to be a raw session-level `SET app.tenant_id`,
-- which is safe ONLY because a bare `psql`/migration-runner connection is
-- never pooled. Once PgBouncer's transaction-mode pooling (PERF-001) is
-- reachable by anything that can run raw SQL (including, hypothetically, a
-- copy-pasted migration snippet run by hand against the pooled port), a
-- session-level `SET` is never released back to the pool by
-- `server_reset_query` (PgBouncer does not run `server_reset_query` in
-- transaction-pool mode unless `server_reset_query_always` is also set —
-- see infra/pgbouncer/pgbouncer.ini) and leaks this tenant's id onto
-- whatever connection/transaction the pool hands out next. Use
-- `set_config(..., true)` (SET LOCAL semantics) inside an explicit
-- transaction instead — same pattern as
-- services/audit-service/migrations/0025_fix_legacy_status_values.sql and
-- packages/db/src/raw-tenant-guc.ts — so the GUC is scoped to exactly this
-- DO block's implicit transaction and can never outlive it, pooled or not.
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

  INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, created_by, updated_by)
  VALUES
    ('dddddddd-0001-0000-0000-000000000075'::uuid,
     '00000000-0000-0000-0000-000000000001'::uuid,
     '0075', 'Municipal Licence & Permit Fees (Non-Tax Revenue)', 1, 'revenue',
     '00000000-0000-0000-0000-000000000000'::uuid,
     '00000000-0000-0000-0000-000000000000'::uuid)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END
$body$;
