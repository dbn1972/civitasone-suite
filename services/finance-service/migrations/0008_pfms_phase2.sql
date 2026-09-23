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
-- on the candidate row before conflict resolution). Wrapped in a DO block using set_config('app.tenant_id', ..., true) --
-- SET LOCAL semantics (transaction-scoped to the DO block's own
-- implicit transaction under psql's per-statement autocommit), not a
-- raw session-scoped SET. This fleet routes through PgBouncer in
-- transaction-pooling mode (PERF-001): a raw SET leaves the GUC on the
-- shared backend connection for whichever unrelated client the pool
-- hands it to next -- a cross-tenant leak for a tenant-scoping GUC. See
-- scripts/ci/raw-session-guc-guard.mjs and the identical pattern in
-- services/audit-service/migrations/0025_fix_legacy_status_values.sql.
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

  INSERT INTO payments.finance_pfms_config (tenant_id, agency_code, default_ddo)
VALUES ('00000000-0000-0000-0000-000000000001', 'AG001', 'DDO123456')
ON CONFLICT (tenant_id) DO NOTHING;
END
$body$;

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
