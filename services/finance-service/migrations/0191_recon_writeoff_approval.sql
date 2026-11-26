-- 0191_recon_writeoff_approval.sql
-- C30 / GAP-FINANCE-RECONCILIATION-01 (owner decision 2026-11-26). Additive and idempotent.
--   1. recon.recon_policy: per-tenant reconciliation policy. writeoff_second_approval_minor is the write-off size (absolute paise)
--      ABOVE which a second approver (finance_admin / super_admin, a different person from the requester) must approve.
--      No row = the platform default (5,000,000 paise = Rs 50,000). THAT DEFAULT IS A PLACEHOLDER: Finance must set the real figure
--      per tenant (PUT /v1/finance/recon/writeoff-policy). 0 means every write-off needs a second approver.
--   2. recon.recon_break gains the pending write-off request (who / when / why). All NULL = no request pending (every existing row).
-- Rollback: ALTER TABLE recon.recon_break DROP COLUMN IF EXISTS writeoff_requested_by, DROP COLUMN IF EXISTS writeoff_requested_at,
--             DROP COLUMN IF EXISTS writeoff_request_note;  DROP TABLE IF EXISTS recon.recon_policy;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recon.recon_policy (
  tenant_id                       UUID PRIMARY KEY,
  writeoff_second_approval_minor  BIGINT NOT NULL DEFAULT 5000000 CHECK (writeoff_second_approval_minor >= 0),
  updated_by                      UUID NOT NULL,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version                         INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE recon.recon_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon.recon_policy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON recon.recon_policy;
CREATE POLICY tenant_isolation_policy ON recon.recon_policy
  USING (tenant_id = recon.current_tenant_id())
  WITH CHECK (tenant_id = recon.current_tenant_id());

ALTER TABLE recon.recon_break ADD COLUMN IF NOT EXISTS writeoff_requested_by   UUID;
ALTER TABLE recon.recon_break ADD COLUMN IF NOT EXISTS writeoff_requested_at   TIMESTAMPTZ;
ALTER TABLE recon.recon_break ADD COLUMN IF NOT EXISTS writeoff_request_note   TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON recon.recon_policy TO finance_svc;
  END IF;
END
$$;
