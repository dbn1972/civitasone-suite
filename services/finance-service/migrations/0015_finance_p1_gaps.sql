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
