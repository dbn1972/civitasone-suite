-- 0187_hrms_outsourced_contracts.sql
--
-- GAP-HR-OUTSOURCED-01: vendor-supplied (outsourced) workforce register. One row per
-- vendor service contract: vendor, service category, supplied headcount, contract
-- window and contract value (paise, bigint). This is a contract-level register, not
-- an employee record -- outsourced staff are the vendor's employees and are not in
-- the employee register. Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS outsourced.hrms_outsourced_contracts;
--           DROP SCHEMA IF EXISTS outsourced;

CREATE SCHEMA IF NOT EXISTS outsourced;

CREATE TABLE IF NOT EXISTS outsourced.hrms_outsourced_contracts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  vendor_name           varchar(200) NOT NULL,
  service_category      varchar(120) NOT NULL,
  contract_ref          varchar(64),
  headcount             integer NOT NULL,
  contract_start        date NOT NULL,
  contract_end          date NOT NULL,
  contract_value_minor  bigint NOT NULL DEFAULT 0,        -- paise
  status                varchar(16) NOT NULL DEFAULT 'active', -- active | terminated
  remarks               text,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  CONSTRAINT hrms_outsourced_contracts_headcount_check CHECK (headcount >= 0),
  CONSTRAINT hrms_outsourced_contracts_value_check CHECK (contract_value_minor >= 0),
  CONSTRAINT hrms_outsourced_contracts_status_check CHECK (status IN ('active', 'terminated')),
  CONSTRAINT hrms_outsourced_contracts_window_check CHECK (contract_end >= contract_start)
);

CREATE INDEX IF NOT EXISTS hrms_outsourced_contracts_tenant_status_idx
  ON outsourced.hrms_outsourced_contracts (tenant_id, status, contract_end);
CREATE INDEX IF NOT EXISTS hrms_outsourced_contracts_tenant_vendor_idx
  ON outsourced.hrms_outsourced_contracts (tenant_id, vendor_name);

ALTER TABLE outsourced.hrms_outsourced_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsourced.hrms_outsourced_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_outsourced_contracts_tenant_isolation ON outsourced.hrms_outsourced_contracts;
CREATE POLICY hrms_outsourced_contracts_tenant_isolation ON outsourced.hrms_outsourced_contracts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Runtime role grants (a brand-new schema does not inherit default privileges).
GRANT USAGE ON SCHEMA outsourced TO hrms_svc;
GRANT SELECT, INSERT, UPDATE ON outsourced.hrms_outsourced_contracts TO hrms_svc;
