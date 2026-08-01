-- Purpose: Persist milestone SLA penalties (bigint paise) and performance bonds / BGs.
-- Rollback: ALTER TABLE ... DROP COLUMN; DROP TABLE contracts.contract_performance_bonds;
-- Affected services: contract-service

SET lock_timeout = '5s';

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS penalty_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE contracts.contract_milestones
  ADD COLUMN IF NOT EXISTS net_payable_minor bigint;

CREATE TABLE IF NOT EXISTS contracts.contract_performance_bonds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   uuid NOT NULL,
  tenant_id     uuid NOT NULL,
  bond_type     varchar(32) NOT NULL DEFAULT 'performance'
    CHECK (bond_type IN ('performance', 'bank_guarantee', 'security_deposit')),
  amount_minor  bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency      char(3) NOT NULL DEFAULT 'INR',
  issuer        text NOT NULL,
  reference_no  text NOT NULL,
  valid_from    date NOT NULL,
  valid_to      date NOT NULL,
  status        varchar(24) NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'released', 'claimed', 'forfeited')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_contract_performance_bonds_contract_id
  ON contracts.contract_performance_bonds (contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_performance_bonds_tenant_id
  ON contracts.contract_performance_bonds (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_performance_bonds_ref
  ON contracts.contract_performance_bonds (tenant_id, reference_no);

ALTER TABLE contracts.contract_performance_bonds ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.contract_performance_bonds FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'contracts' AND tablename = 'contract_performance_bonds' AND policyname = 'tenant_isolation_policy'
  ) THEN
    CREATE POLICY tenant_isolation_policy ON contracts.contract_performance_bonds
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;
