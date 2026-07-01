-- 0030: Denormalize read models to eliminate cross-schema JOINs.
--
-- Architecture rule: no cross-schema JOINs, even within the same service.
-- Reports and dashboards currently JOIN budget→gl→payments→treasury.
-- Fix: maintain pre-computed summaries updated at write time (CQRS read models).
--
-- (a) budget.head_utilisation — pre-aggregated expenditure per head per FY.
--     Updated by the bill/payment consumer on every bill.approve / payment.made.
-- (b) gl.finance_journal_lines — denormalized from JSONB lines[] column.
--     Written atomically with the journal in the GL consumer (no LATERAL needed).
-- (c) payments.finance_payments gains ddo_code + bank_name columns
--     (copied from bill/bank at write time — no PFMS JOIN needed).
--
-- Additive, idempotent, forward-only.

-- (a) Budget utilisation summary (replaces the 3-table JOIN report query).
CREATE TABLE IF NOT EXISTS budget.head_utilisation (
  tenant_id       UUID NOT NULL,
  head_id         UUID NOT NULL,
  fy              CHAR(7) NOT NULL,                   -- '2025-26'
  allocated_minor BIGINT NOT NULL DEFAULT 0,
  committed_minor BIGINT NOT NULL DEFAULT 0,          -- bills passed but not paid
  expended_minor  BIGINT NOT NULL DEFAULT 0,          -- payments actually made
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, head_id, fy)
);

-- (b) Journal lines (denormalized from finance_journals.lines JSONB).
CREATE TABLE IF NOT EXISTS gl.finance_journal_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  journal_id      UUID NOT NULL,
  head_id         UUID NOT NULL,
  debit_minor     BIGINT NOT NULL DEFAULT 0,
  credit_minor    BIGINT NOT NULL DEFAULT 0,
  narration       TEXT,
  posting_date    DATE NOT NULL,
  journal_type    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON gl.finance_journal_lines (journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_head ON gl.finance_journal_lines (tenant_id, head_id, journal_type);
CREATE INDEX IF NOT EXISTS idx_journal_lines_type ON gl.finance_journal_lines (tenant_id, journal_type, posting_date);

-- (c) Embed bill/bank context into payments (eliminates PFMS JOIN).
ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS ddo_code_denorm TEXT,
  ADD COLUMN IF NOT EXISTS bank_name_denorm TEXT;

GRANT SELECT, INSERT, UPDATE, DELETE ON budget.head_utilisation TO finance_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON gl.finance_journal_lines TO finance_svc;
