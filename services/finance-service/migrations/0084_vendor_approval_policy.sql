-- Migration 0084: vendor approval workflow + finance policy (fp-finance-02)
--
-- GAP-FINANCE-VENDORS-01 / GAP-FINANCE-VENDORS-DETAIL-04 / PAYMENTS (policy):
--  * payments.finance_policy: ONE per-tenant row of conservative, configurable
--    policy switches (defaults ON = maker != checker enforced server-side).
--      vendor_maker_checker      new vendors start 'pending'; a DIFFERENT user
--                                must approve; vendor bank-detail changes are
--                                proposed then approved by a different user.
--      audit_para_maker_checker  the user who recorded a para's department
--                                reply may not also settle it.
--      cheque_validity_months    stale-cheque horizon (RBI: 3 months from the
--                                instrument date; configurable per tenant).
--  * payments.finance_vendors.status: pending | active | inactive | rejected.
--    is_active stays as the 'can transact' mirror (status = 'active') so every
--    existing reader (bill vendor check, PFMS bank file) keeps working.
--  * payments.finance_vendor_bank_changes: a pending bank-detail change request
--    (maker proposes, a different checker decides). Account number and IFSC are
--    encrypted at rest exactly like finance_vendors.bank_account_no / ifsc.

CREATE TABLE IF NOT EXISTS payments.finance_policy (
  tenant_id                uuid PRIMARY KEY,
  vendor_maker_checker     boolean NOT NULL DEFAULT true,
  audit_para_maker_checker boolean NOT NULL DEFAULT true,
  cheque_validity_months   integer NOT NULL DEFAULT 3,
  updated_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_finance_policy_cheque_months CHECK (cheque_validity_months BETWEEN 1 AND 12)
);

ALTER TABLE payments.finance_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_policy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_policy;
CREATE POLICY tenant_isolation_policy ON payments.finance_policy
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- Loosening a policy (turning a maker != checker switch OFF, or raising the cheque validity above the RBI 3
-- months) is itself a two-person act: it is stored here as a pending request and applied only when a DIFFERENT
-- admin approves it (conditional UPDATE: status = pending AND proposed_by <> actor). Tightening is immediate.
CREATE TABLE IF NOT EXISTS payments.finance_policy_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  patch           jsonb NOT NULL,
  status          varchar(12) NOT NULL DEFAULT 'pending',
  proposed_by     uuid NOT NULL,
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_reason text,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_policy_change_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_policy_changes_tenant ON payments.finance_policy_changes(tenant_id, status);

ALTER TABLE payments.finance_policy_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_policy_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_policy_changes;
CREATE POLICY tenant_isolation_policy ON payments.finance_policy_changes
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

ALTER TABLE payments.finance_vendors ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'active';
ALTER TABLE payments.finance_vendors ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE payments.finance_vendors ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE payments.finance_vendors ADD COLUMN IF NOT EXISTS decision_reason text;

-- Backfill: rows deactivated before this migration keep meaning 'inactive'.
UPDATE payments.finance_vendors SET status = 'inactive' WHERE is_active = false AND status = 'active';

DO $$ BEGIN
  ALTER TABLE payments.finance_vendors
    ADD CONSTRAINT chk_vendor_status CHECK (status IN ('pending', 'active', 'inactive', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS payments.finance_vendor_bank_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  vendor_id           uuid NOT NULL,
  proposed_bank_name  text NOT NULL,
  proposed_account_no text NOT NULL,
  proposed_ifsc       text NOT NULL,
  reason              text NOT NULL,
  status              varchar(12) NOT NULL DEFAULT 'pending',
  proposed_by         uuid NOT NULL,
  proposed_at         timestamptz NOT NULL DEFAULT now(),
  decided_by          uuid,
  decided_at          timestamptz,
  decision_reason     text,
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_vendor_bank_change_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_bank_changes_tenant ON payments.finance_vendor_bank_changes(tenant_id, vendor_id);
-- At most ONE open request per vendor: a second proposal while one is pending is a 409.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_bank_change_pending
  ON payments.finance_vendor_bank_changes(tenant_id, vendor_id) WHERE status = 'pending';

ALTER TABLE payments.finance_vendor_bank_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_vendor_bank_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_vendor_bank_changes;
CREATE POLICY tenant_isolation_policy ON payments.finance_vendor_bank_changes
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
