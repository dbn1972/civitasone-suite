-- 0050: Booking module — community hall / facility booking for establishments
-- (BRD 5.22 HALL-001…005).
--
-- GAP2-ESTAB-BOOKING-ORPHAN-01: the booking route + command + query modules
-- shipped in src/modules/booking but were never registered in app.ts/worker.ts
-- and had NO migration creating their tables, so every endpoint 404'd and the
-- Drizzle models drifted from the (absent) DB. This migration creates the three
-- booking tables so the now-registered routes + consumer are reachable and real.
--
-- New PG schema: booking
-- New tables:
--   booking.estab_facilities_catalog — bookable facilities inventory
--   booking.estab_bookings           — booking requests + lifecycle (money: paise)
--   booking.estab_booking_calendar   — slot-level availability / blocking
--
-- Additive + idempotent (IF NOT EXISTS throughout). Money columns: bigint paise.
-- Timestamps: timestamptz. Optimistic locking via version. RLS: ENABLE + FORCE +
-- per-table tenant-isolation policy (plain statements per table).
--
-- Rollback: DROP SCHEMA booking CASCADE;  (destroys all 3 tables — use only if never populated)

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS booking;

-- ─── (a) Facilities catalogue ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking.estab_facilities_catalog (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  facility_name          TEXT NOT NULL,
  facility_type          VARCHAR(32) NOT NULL,
  address                JSONB,
  ward                   VARCHAR(64),
  capacity               INTEGER,
  amenities              JSONB,
  photos                 JSONB,
  rate_per_hour_minor    BIGINT,
  rate_per_day_minor     BIGINT,
  currency               CHAR(3) NOT NULL DEFAULT 'INR',
  security_deposit_minor BIGINT,
  status                 VARCHAR(24) NOT NULL DEFAULT 'active',
  operating_hours        JSONB,
  closed_days            JSONB,
  rules                  TEXT,
  contact_person         TEXT,
  contact_phone          VARCHAR(15),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID NOT NULL,
  updated_by             UUID NOT NULL,
  version                INT NOT NULL DEFAULT 1
);
ALTER TABLE booking.estab_facilities_catalog DROP CONSTRAINT IF EXISTS chk_facility_status;
ALTER TABLE booking.estab_facilities_catalog
  ADD CONSTRAINT chk_facility_status CHECK (status IN ('active','inactive','under_maintenance'));
CREATE INDEX IF NOT EXISTS idx_estab_facilities_tenant_status
  ON booking.estab_facilities_catalog (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_estab_facilities_tenant_type
  ON booking.estab_facilities_catalog (tenant_id, facility_type);
ALTER TABLE booking.estab_facilities_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking.estab_facilities_catalog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_facilities_tenant ON booking.estab_facilities_catalog;
CREATE POLICY rls_facilities_tenant ON booking.estab_facilities_catalog
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─── (b) Bookings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking.estab_bookings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  booking_number         TEXT NOT NULL,
  facility_id            UUID NOT NULL,
  applicant_name         TEXT NOT NULL,
  applicant_phone        VARCHAR(15) NOT NULL,
  applicant_email        VARCHAR(255),
  purpose                TEXT,
  event_type             VARCHAR(24) NOT NULL DEFAULT 'other',
  event_date             DATE NOT NULL,
  start_time             VARCHAR(8) NOT NULL,
  end_time               VARCHAR(8) NOT NULL,
  duration_hours         INTEGER,
  guest_count            INTEGER,
  requirements           JSONB,
  status                 VARCHAR(24) NOT NULL DEFAULT 'draft',
  approved_by            UUID,
  approved_at            TIMESTAMPTZ,
  amount_minor           BIGINT,
  security_deposit_minor BIGINT,
  total_minor            BIGINT,
  currency               CHAR(3) NOT NULL DEFAULT 'INR',
  payment_ref            TEXT,
  paid_at                TIMESTAMPTZ,
  cancellation_reason    TEXT,
  cancelled_at           TIMESTAMPTZ,
  refund_amount_minor    BIGINT,
  refund_ref             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID NOT NULL,
  updated_by             UUID NOT NULL,
  version                INT NOT NULL DEFAULT 1
);
ALTER TABLE booking.estab_bookings DROP CONSTRAINT IF EXISTS chk_booking_status;
ALTER TABLE booking.estab_bookings
  ADD CONSTRAINT chk_booking_status CHECK (
    status IN ('draft','submitted','approved','payment_pending','confirmed','completed','cancelled','refund_initiated','refunded')
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_estab_bookings_tenant_number
  ON booking.estab_bookings (tenant_id, booking_number);
CREATE INDEX IF NOT EXISTS idx_estab_bookings_tenant_facility
  ON booking.estab_bookings (tenant_id, facility_id);
CREATE INDEX IF NOT EXISTS idx_estab_bookings_tenant_status
  ON booking.estab_bookings (tenant_id, status);
ALTER TABLE booking.estab_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking.estab_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_bookings_tenant ON booking.estab_bookings;
CREATE POLICY rls_bookings_tenant ON booking.estab_bookings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─── (c) Booking calendar (slot availability / blocking) ─────────────────────
CREATE TABLE IF NOT EXISTS booking.estab_booking_calendar (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  facility_id   UUID NOT NULL,
  booking_date  DATE NOT NULL,
  slot_start    VARCHAR(8) NOT NULL,
  slot_end      VARCHAR(8) NOT NULL,
  booking_id    UUID,
  is_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_estab_booking_cal_tenant_facility_date
  ON booking.estab_booking_calendar (tenant_id, facility_id, booking_date);
ALTER TABLE booking.estab_booking_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking.estab_booking_calendar FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_booking_calendar_tenant ON booking.estab_booking_calendar;
CREATE POLICY rls_booking_calendar_tenant ON booking.estab_booking_calendar
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ─── Grants ─────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA booking TO estab_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA booking TO estab_svc;
