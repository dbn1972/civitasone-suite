-- 0017 cheque / DD payment instruments — additive + idempotent.
-- Tier-1 residual: physical payment instruments (cheque / demand draft) with a
-- tenant-scoped issuance + status lifecycle (issued -> presented ->
-- cleared|bounced|cancelled). Money is PAISE bigint. No GL coupling here — the
-- instrument records the lifecycle of a cheque/DD raised against a bank account;
-- the underlying disbursement is already journalled by the payments/GL spine.

CREATE TABLE IF NOT EXISTS treasury.finance_instruments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  instrument_type   varchar(8)  NOT NULL,          -- 'cheque' | 'dd'
  instrument_no     text        NOT NULL,          -- cheque / DD serial number
  bank_account_id   uuid,                           -- drawee bank account (treasury.finance_banks.id)
  bank_name         text        NOT NULL,
  payee             text        NOT NULL,
  amount_minor      bigint      NOT NULL,
  currency          char(3)     NOT NULL DEFAULT 'INR',
  issue_date        date        NOT NULL DEFAULT CURRENT_DATE,
  status            varchar(16) NOT NULL DEFAULT 'issued',  -- issued|presented|cleared|bounced|cancelled
  presented_at      timestamptz,
  cleared_at        timestamptz,
  bounced_at        timestamptz,
  cancelled_at      timestamptz,
  bounce_reason     text,
  payment_id        uuid,                           -- optional link to payments.finance_payments
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1,
  CONSTRAINT chk_finance_instruments_type   CHECK (instrument_type IN ('cheque','dd')),
  CONSTRAINT chk_finance_instruments_status CHECK (status IN ('issued','presented','cleared','bounced','cancelled')),
  CONSTRAINT chk_finance_instruments_amount CHECK (amount_minor > 0)
);

-- Tenant-scoped uniqueness: an instrument number is unique per tenant + type.
-- This is also the idempotency key for issuance (re-issuing the same number is a
-- no-op / conflict, never a duplicate row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_instruments_tenant_type_no
  ON treasury.finance_instruments (tenant_id, instrument_type, instrument_no);

CREATE INDEX IF NOT EXISTS idx_finance_instruments_tenant_status
  ON treasury.finance_instruments (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_finance_instruments_tenant_bank
  ON treasury.finance_instruments (tenant_id, bank_account_id);
