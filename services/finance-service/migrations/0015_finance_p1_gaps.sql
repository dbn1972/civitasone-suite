-- Migration 0015: finance-service P1 gaps.
-- Additive + idempotent only. Safe to re-run.
--
-- Covers:
--   P1-1  Gapless numbering for ALL document types: the per (tenant,fy,series)
--         allocator already exists (gl.finance_voucher_counter). No DDL needed
--         beyond ensuring the series column is wide enough (it is, varchar(16)).
--   P1-2  Cash book population: gl.finance_cash_book already exists. We add a
--         partial unique index on (tenant_id, reference) so a redelivered
--         payment/challan cannot insert a duplicate cash-book row (idempotency).
--   P1-3  Deposit (EMD/SD/retention) lifecycle: add lifecycle columns to
--         treasury.finance_deposits, a deposit-event ledger, and seed the
--         liability / forfeiture-income control heads.
--   (P5 has no schema change.)

-- ============================================================
-- P1-2: cash book idempotency. reference holds the source key
-- ("payment:<uuid>" / "challan:<uuid>"); make it unique per tenant so a
-- redelivered command is a no-op (ON CONFLICT DO NOTHING in code).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashbook_tenant_reference
  ON gl.finance_cash_book (tenant_id, reference)
  WHERE reference IS NOT NULL;

-- ============================================================
-- P1-3: deposit lifecycle columns (additive).
--   sourceBillId  : when retention is held from a bill, the originating bill.
--   forfeitedMinor / refundedMinor / adjustedMinor : running totals of the
--     lifecycle disposition; balanceMinor remains the live held amount.
-- ============================================================
ALTER TABLE treasury.finance_deposits
  ADD COLUMN IF NOT EXISTS source_bill_id  uuid,
  ADD COLUMN IF NOT EXISTS forfeited_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_minor  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_minor  bigint NOT NULL DEFAULT 0;

-- Deposit lifecycle event log (append-only audit of refund/forfeit/adjust).
CREATE TABLE IF NOT EXISTS treasury.finance_deposit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  deposit_id   uuid NOT NULL,
  event_type   varchar(24) NOT NULL,           -- refund | forfeit | adjust
  amount_minor bigint NOT NULL,
  reference    varchar(128),                    -- e.g. bill id for an adjustment
  journal_id   uuid,                            -- the GL journal posted for this event
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  CONSTRAINT chk_deposit_event_type
    CHECK (event_type IN ('refund','forfeit','adjust'))
);

CREATE INDEX IF NOT EXISTS idx_deposit_events_tenant_deposit
  ON treasury.finance_deposit_events (tenant_id, deposit_id);

-- Idempotency: one event row per (deposit, source command). reference carries
-- the command messageId-derived key so redelivery is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_event_idem
  ON treasury.finance_deposit_events (tenant_id, deposit_id, event_type, reference)
  WHERE reference IS NOT NULL;

-- ============================================================
-- P1-3: control heads for deposit liabilities + forfeiture income (per default
-- tenant, idempotent). Production tenants get them on first use via the same
-- codes (consumer resolves by code and hard-errors if absent, mirroring AP).
--   2060 Deposits / Retention (Control)  [liability]
--   4300 Forfeited Deposits Income       [revenue]
-- ============================================================
-- Idempotent under a second full bootstrap re-run: this seed relies on
-- running before RLS is enabled later in this file/sequence (see the
-- comment above), which is only true the FIRST time it is applied. On a
-- re-run against an already-migrated cluster, RLS is already active and
-- this session never otherwise sets app.tenant_id, so WITH CHECK would
-- reject this row regardless of ON CONFLICT (Postgres evaluates WITH CHECK
-- on the candidate row before conflict resolution). Wrapped in a DO block using set_config('app.tenant_id', ..., true) --
-- SET LOCAL semantics (transaction-scoped to the DO block's own
-- implicit transaction under psql's per-statement autocommit), not a
-- raw session-scoped SET. This fleet routes through PgBouncer in
-- transaction-pooling mode (PERF-001): a raw SET leaves the GUC on the
-- shared backend connection for whichever unrelated client the pool
-- hands it to next -- a cross-tenant leak for a tenant-scoping GUC. See
-- scripts/ci/raw-session-guc-guard.mjs and the identical pattern in
-- services/audit-service/migrations/0025_fix_legacy_status_values.sql.
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, created_by, updated_by)
VALUES
  ('dddddddd-0001-0000-0000-000000002060'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   '2060', 'Deposits / Retention (Control)', 1, 'liability',
   '00000000-0000-0000-0000-000000000000'::uuid,
   '00000000-0000-0000-0000-000000000000'::uuid),
  ('dddddddd-0001-0000-0000-000000004300'::uuid,
   '00000000-0000-0000-0000-000000000001'::uuid,
   '4300', 'Forfeited Deposits Income', 1, 'revenue',
   '00000000-0000-0000-0000-000000000000'::uuid,
   '00000000-0000-0000-0000-000000000000'::uuid)
ON CONFLICT (tenant_id, code) DO NOTHING;

END
$body$;
