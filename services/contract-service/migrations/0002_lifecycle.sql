-- contract-service 0002: lifecycle hardening (additive, idempotent).
-- Safe to re-run. Run as contract_svc on civitas_contract.

-- Read-model support: list active + expiring contracts cheaply.
CREATE INDEX IF NOT EXISTS idx_contracts_active_expiry
  ON contracts.contract_contracts (tenant_id, expiry)
  WHERE status = 'active';

-- One amendment number per contract (no duplicate variation rows on redelivery).
CREATE UNIQUE INDEX IF NOT EXISTS uq_amendment_no
  ON contracts.contract_amendments (contract_id, amendment_no);

-- Lifecycle audit: index lookups by status for the per-tenant list.
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_status_created
  ON contracts.contract_contracts (tenant_id, status, created_at DESC);
