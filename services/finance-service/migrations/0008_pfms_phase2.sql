-- PFMS Phase 2: agency/scheme codes, tenant config, DSC signing metadata

CREATE TABLE IF NOT EXISTS payments.finance_pfms_config (
  tenant_id     uuid PRIMARY KEY,
  agency_code   varchar(12) NOT NULL,
  default_ddo   varchar(12),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pfms_config_agency CHECK (agency_code ~ '^[A-Z0-9]{4,12}$')
);

-- Idempotent under a second full bootstrap re-run: this seed relies on
-- running before RLS is enabled later in this file/sequence (see the
-- comment above), which is only true the FIRST time it is applied. On a
-- re-run against an already-migrated cluster, RLS is already active and
-- this session never otherwise sets app.tenant_id, so WITH CHECK would
-- reject this row regardless of ON CONFLICT (Postgres evaluates WITH CHECK
-- on the candidate row before conflict resolution). Session-scoped (not
-- SET LOCAL): bootstrap-postgres.sh runs this file as its own psql -f
-- connection with per-statement autocommit, not one transaction.
SET app.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO payments.finance_pfms_config (tenant_id, agency_code, default_ddo)
VALUES ('00000000-0000-0000-0000-000000000001', 'AG001', 'DDO123456')
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE budget.finance_schemes
  ADD COLUMN IF NOT EXISTS pfms_scheme_code varchar(20);

ALTER TABLE payments.finance_bills
  ADD COLUMN IF NOT EXISTS agency_code varchar(12);

ALTER TABLE payments.finance_bills
  ADD COLUMN IF NOT EXISTS scheme_code varchar(20);

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS agency_code varchar(12);

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS scheme_code varchar(20);

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS ddo_code varchar(12);

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS bank_file_hash text;

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS signed_at timestamptz;

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS signed_by uuid;

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS signature_ref text;

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS submission_status varchar(24) NOT NULL DEFAULT 'pending';

RESET app.tenant_id;
