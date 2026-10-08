-- 0051: Citizen-lease module — municipal property leasing for citizens
-- (BRD 5.26 ESTATE-001…004).
--
-- GAP2-ESTAB-BOOKING-ORPHAN-01 (sibling): the citizen-lease route + command +
-- query modules shipped in src/modules/citizen-lease but were never registered
-- in app.ts/worker.ts and had NO migration creating their tables, so every
-- endpoint 404'd. This migration creates the four tables so the now-registered
-- routes + consumer are reachable and real.
--
-- New PG schema: citizen_lease
-- New tables:
--   citizen_lease.estab_lease_properties — leasable property inventory
--   citizen_lease.estab_leases           — active lease agreements (money: paise)
--   citizen_lease.estab_lease_payments   — monthly rent payment records (money: paise)
--   citizen_lease.estab_lease_requests   — renewal/transfer/surrender/no-dues requests
--
-- Additive + idempotent (IF NOT EXISTS throughout). Money columns: bigint paise.
-- Timestamps: timestamptz. Optimistic locking via version. RLS: ENABLE + FORCE +
-- per-table tenant-isolation policy (plain statements per table).
--
-- Rollback: DROP SCHEMA citizen_lease CASCADE;  (destroys all 4 tables — use only if never populated)

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS citizen_lease;

-- ─── (a) Lease properties ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citizen_lease.estab_lease_properties (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  property_code      TEXT NOT NULL,
  property_type      VARCHAR(24) NOT NULL,
  location           JSONB,
  area               NUMERIC(12,2),
  area_unit          VARCHAR(16) NOT NULL DEFAULT 'sqft',
  monthly_rent_minor BIGINT NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'INR',
  lease_term_months  INTEGER,
  status             VARCHAR(24) NOT NULL DEFAULT 'available',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID NOT NULL,
  updated_by         UUID NOT NULL,
  version            INT NOT NULL DEFAULT 1
);
ALTER TABLE citizen_lease.estab_lease_properties DROP CONSTRAINT IF EXISTS chk_lease_property_status;
ALTER TABLE citizen_lease.estab_lease_properties
  ADD CONSTRAINT chk_lease_property_status CHECK (status IN ('available','leased','under_maintenance','retired'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_lease_property_tenant_code
  ON citizen_lease.estab_lease_properties (tenant_id, property_code);
CREATE INDEX IF NOT EXISTS idx_estab_lease_property_tenant_status
  ON citizen_lease.estab_lease_properties (tenant_id, status);
ALTER TABLE citizen_lease.estab_lease_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_lease.estab_lease_properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_lease_properties_tenant ON citizen_lease.estab_lease_properties;
CREATE POLICY rls_lease_properties_tenant ON citizen_lease.estab_lease_properties
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─── (b) Leases ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citizen_lease.estab_leases (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  lease_number           TEXT NOT NULL,
  property_id            UUID NOT NULL,
  tenant_name            TEXT NOT NULL,
  tenant_phone           VARCHAR(15) NOT NULL,
  tenant_aadhaar         VARCHAR(12),
  tenant_address         JSONB,
  lease_start_date       DATE NOT NULL,
  lease_end_date         DATE NOT NULL,
  monthly_rent_minor     BIGINT NOT NULL,
  security_deposit_minor BIGINT,
  currency               CHAR(3) NOT NULL DEFAULT 'INR',
  status                 VARCHAR(24) NOT NULL DEFAULT 'active',
  renewal_count          INT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID NOT NULL,
  updated_by             UUID NOT NULL,
  version                INT NOT NULL DEFAULT 1
);
ALTER TABLE citizen_lease.estab_leases DROP CONSTRAINT IF EXISTS chk_lease_status;
ALTER TABLE citizen_lease.estab_leases
  ADD CONSTRAINT chk_lease_status CHECK (
    status IN ('active','expired','renewed','transferred','surrendered','terminated')
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_leases_tenant_number
  ON citizen_lease.estab_leases (tenant_id, lease_number);
CREATE INDEX IF NOT EXISTS idx_estab_leases_tenant_property
  ON citizen_lease.estab_leases (tenant_id, property_id);
CREATE INDEX IF NOT EXISTS idx_estab_leases_tenant_status
  ON citizen_lease.estab_leases (tenant_id, status);
ALTER TABLE citizen_lease.estab_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_lease.estab_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_leases_tenant ON citizen_lease.estab_leases;
CREATE POLICY rls_leases_tenant ON citizen_lease.estab_leases
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─── (c) Lease payments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citizen_lease.estab_lease_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  lease_id       UUID NOT NULL,
  payment_month  VARCHAR(7) NOT NULL,
  amount_minor   BIGINT NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  due_date       DATE NOT NULL,
  paid_at        TIMESTAMPTZ,
  payment_ref    TEXT,
  status         VARCHAR(16) NOT NULL DEFAULT 'pending',
  late_fee_minor BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID NOT NULL,
  updated_by     UUID NOT NULL,
  version        INT NOT NULL DEFAULT 1
);
ALTER TABLE citizen_lease.estab_lease_payments DROP CONSTRAINT IF EXISTS chk_lease_payment_status;
ALTER TABLE citizen_lease.estab_lease_payments
  ADD CONSTRAINT chk_lease_payment_status CHECK (status IN ('pending','paid','overdue','waived'));
CREATE INDEX IF NOT EXISTS idx_estab_lease_payments_tenant_lease
  ON citizen_lease.estab_lease_payments (tenant_id, lease_id);
ALTER TABLE citizen_lease.estab_lease_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_lease.estab_lease_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_lease_payments_tenant ON citizen_lease.estab_lease_payments;
CREATE POLICY rls_lease_payments_tenant ON citizen_lease.estab_lease_payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─── (d) Lease requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citizen_lease.estab_lease_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  lease_id                UUID NOT NULL,
  request_type            VARCHAR(16) NOT NULL,
  request_number          TEXT NOT NULL,
  requested_by            UUID NOT NULL,
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                  VARCHAR(24) NOT NULL DEFAULT 'submitted',
  transferee_name         TEXT,
  transferee_phone        VARCHAR(15),
  transferee_aadhaar      VARCHAR(12),
  surrender_date          DATE,
  no_dues_certificate_ref TEXT,
  approved_by             UUID,
  approved_at             TIMESTAMPTZ,
  remarks                 TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID NOT NULL,
  updated_by              UUID NOT NULL,
  version                 INT NOT NULL DEFAULT 1
);
ALTER TABLE citizen_lease.estab_lease_requests DROP CONSTRAINT IF EXISTS chk_lease_request_type;
ALTER TABLE citizen_lease.estab_lease_requests
  ADD CONSTRAINT chk_lease_request_type CHECK (request_type IN ('renewal','transfer','surrender','no_dues'));
ALTER TABLE citizen_lease.estab_lease_requests DROP CONSTRAINT IF EXISTS chk_lease_request_status;
ALTER TABLE citizen_lease.estab_lease_requests
  ADD CONSTRAINT chk_lease_request_status CHECK (
    status IN ('submitted','under_review','approved','rejected','completed')
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_lease_requests_tenant_number
  ON citizen_lease.estab_lease_requests (tenant_id, request_number);
CREATE INDEX IF NOT EXISTS idx_estab_lease_requests_tenant_lease
  ON citizen_lease.estab_lease_requests (tenant_id, lease_id);
CREATE INDEX IF NOT EXISTS idx_estab_lease_requests_tenant_status
  ON citizen_lease.estab_lease_requests (tenant_id, status);
ALTER TABLE citizen_lease.estab_lease_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_lease.estab_lease_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_lease_requests_tenant ON citizen_lease.estab_lease_requests;
CREATE POLICY rls_lease_requests_tenant ON citizen_lease.estab_lease_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─── Grants ─────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA citizen_lease TO estab_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA citizen_lease TO estab_svc;
