-- 0019_offline_payments_settings_reminders.sql
-- GAP-ADMIN-INVOICES-06 follow-up:
--   * invoices.billing_offline_payments   : maker-checked requests to record an OFFLINE payment
--                                           (NEFT / RTGS / cheque / DD) the gateway webhooks never see.
--   * invoices.billing_settings           : per-tenant switches (offline maker-checker, default ON;
--                                           scheduled overdue reminder days, default OFF).
--   * invoices.billing_setting_requests   : turning maker-checker OFF is itself a request that a
--                                           second administrator must approve.
--   * invoices.billing_invoice_reminders  : one row per reminder sent (rate limit + "last sent").
-- All tables are tenant-scoped with FORCE ROW LEVEL SECURITY. billing_settings additionally has a
-- SELECT-only platform-bypass policy (GUC app.platform_bypass, set only by the trusted reminder
-- sweep) so the scheduler can find tenants that enabled scheduled reminders.
-- Idempotent. Rollback: DROP the four tables and policy platform_bypass_read_policy.
-- Affected services: billing-service

SET lock_timeout = '5s';

-- RLS uses plans.current_tenant_id() (created by 0006) like every other billing table.

CREATE TABLE IF NOT EXISTS invoices.billing_offline_payments (
  id               UUID PRIMARY KEY,
  tenant_id        UUID         NOT NULL,
  invoice_id       UUID         NOT NULL,
  mode             VARCHAR(8)   NOT NULL,
  reference        VARCHAR(40)  NOT NULL,
  reference_norm   VARCHAR(40)  NOT NULL,
  paid_on          DATE         NOT NULL,
  amount_minor     BIGINT       NOT NULL,
  reason           TEXT         NOT NULL,
  status           VARCHAR(12)  NOT NULL DEFAULT 'pending',
  requested_by     UUID         NOT NULL,
  decided_by       UUID,
  decided_at       TIMESTAMPTZ,
  decision_reason  TEXT,
  payment_id       UUID,
  auto_approved    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  version          INTEGER      NOT NULL DEFAULT 1,
  CONSTRAINT ck_offline_payments_mode   CHECK (mode IN ('neft', 'rtgs', 'cheque', 'dd')),
  CONSTRAINT ck_offline_payments_status CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ck_offline_payments_amount CHECK (amount_minor > 0),
  -- maker != checker, enforced by the database too: only a tenant-wide "maker-checker off" auto-approval
  -- may carry the requester as the decider.
  CONSTRAINT ck_offline_payments_maker_checker CHECK (auto_approved OR decided_by IS DISTINCT FROM requested_by)
);
-- A reference (UTR / instrument no.) can be used once per tenant AND mode while pending or approved
-- (a cheque number and a draft number can legitimately coincide; a UTR cannot repeat within its mode).
CREATE UNIQUE INDEX IF NOT EXISTS uq_offline_payments_reference
  ON invoices.billing_offline_payments (tenant_id, mode, reference_norm) WHERE status IN ('pending', 'approved');
-- At most one pending request per invoice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_offline_payments_pending_invoice
  ON invoices.billing_offline_payments (invoice_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_offline_payments_tenant_invoice
  ON invoices.billing_offline_payments (tenant_id, invoice_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoices.billing_settings (
  tenant_id               UUID PRIMARY KEY,
  offline_maker_checker   BOOLEAN     NOT NULL DEFAULT TRUE,
  reminder_overdue_days   INTEGER,
  updated_by              UUID        NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version                 INTEGER     NOT NULL DEFAULT 1,
  CONSTRAINT ck_billing_settings_days CHECK (reminder_overdue_days IS NULL OR reminder_overdue_days BETWEEN 1 AND 365)
);

CREATE TABLE IF NOT EXISTS invoices.billing_setting_requests (
  id               UUID PRIMARY KEY,
  tenant_id        UUID         NOT NULL,
  setting_key      VARCHAR(32)  NOT NULL,
  requested_value  BOOLEAN      NOT NULL,
  reason           TEXT         NOT NULL,
  status           VARCHAR(12)  NOT NULL DEFAULT 'pending',
  requested_by     UUID         NOT NULL,
  decided_by       UUID,
  decided_at       TIMESTAMPTZ,
  decision_reason  TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  version          INTEGER      NOT NULL DEFAULT 1,
  CONSTRAINT ck_setting_requests_key    CHECK (setting_key IN ('offline_maker_checker')),
  CONSTRAINT ck_setting_requests_status CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ck_setting_requests_maker_checker CHECK (decided_by IS DISTINCT FROM requested_by OR status = 'rejected')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_setting_requests_pending
  ON invoices.billing_setting_requests (tenant_id, setting_key) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS invoices.billing_invoice_reminders (
  id               UUID PRIMARY KEY,
  tenant_id        UUID         NOT NULL,
  invoice_id       UUID         NOT NULL,
  trigger_kind     VARCHAR(10)  NOT NULL,
  requested_by     UUID,
  recipient_count  INTEGER      NOT NULL,
  sent_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_invoice_reminders_trigger CHECK (trigger_kind IN ('manual', 'scheduled'))
);
CREATE INDEX IF NOT EXISTS ix_invoice_reminders_tenant_invoice
  ON invoices.billing_invoice_reminders (tenant_id, invoice_id, sent_at DESC);

ALTER TABLE invoices.billing_offline_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_offline_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_offline_payments;
CREATE POLICY tenant_isolation_policy ON invoices.billing_offline_payments
  USING (tenant_id = plans.current_tenant_id()) WITH CHECK (tenant_id = plans.current_tenant_id());

ALTER TABLE invoices.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_settings;
CREATE POLICY tenant_isolation_policy ON invoices.billing_settings
  USING (tenant_id = plans.current_tenant_id()) WITH CHECK (tenant_id = plans.current_tenant_id());
DROP POLICY IF EXISTS platform_bypass_read_policy ON invoices.billing_settings;
CREATE POLICY platform_bypass_read_policy ON invoices.billing_settings
  FOR SELECT USING (current_setting('app.platform_bypass', true) = 'true');

ALTER TABLE invoices.billing_setting_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_setting_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_setting_requests;
CREATE POLICY tenant_isolation_policy ON invoices.billing_setting_requests
  USING (tenant_id = plans.current_tenant_id()) WITH CHECK (tenant_id = plans.current_tenant_id());

ALTER TABLE invoices.billing_invoice_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_invoice_reminders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_invoice_reminders;
CREATE POLICY tenant_isolation_policy ON invoices.billing_invoice_reminders
  USING (tenant_id = plans.current_tenant_id()) WITH CHECK (tenant_id = plans.current_tenant_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_svc') THEN
    GRANT USAGE ON SCHEMA invoices TO billing_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA invoices TO billing_svc;
  END IF;
END $$;
