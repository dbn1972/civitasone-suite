-- HRMS Tier-2 residuals: transfer orders, service-book attestation, RTI register, LMS completion
-- Additive + idempotent only.

------------------------------------------------------------------------------
-- 1. Transfer orders: formal order lifecycle on top of lifecycle.hrms_transfers
------------------------------------------------------------------------------
-- station / posting on the transfer (from/to) and order/relieving/joining dates.
ALTER TABLE lifecycle.hrms_transfers ADD COLUMN IF NOT EXISTS from_station VARCHAR(128);
ALTER TABLE lifecycle.hrms_transfers ADD COLUMN IF NOT EXISTS to_station   VARCHAR(128);
ALTER TABLE lifecycle.hrms_transfers ADD COLUMN IF NOT EXISTS order_no      VARCHAR(64);
ALTER TABLE lifecycle.hrms_transfers ADD COLUMN IF NOT EXISTS order_date    DATE;
ALTER TABLE lifecycle.hrms_transfers ADD COLUMN IF NOT EXISTS relieved_date DATE;
ALTER TABLE lifecycle.hrms_transfers ADD COLUMN IF NOT EXISTS joined_date   DATE;

-- station on the employee master so a transfer can update posting/station.
ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS station VARCHAR(128);

------------------------------------------------------------------------------
-- 2. Service-book attestation (immutable once attested)
------------------------------------------------------------------------------
ALTER TABLE lifecycle.hrms_service_book_entries ADD COLUMN IF NOT EXISTS attested      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lifecycle.hrms_service_book_entries ADD COLUMN IF NOT EXISTS attested_by   UUID;
ALTER TABLE lifecycle.hrms_service_book_entries ADD COLUMN IF NOT EXISTS attested_at   TIMESTAMPTZ;
ALTER TABLE lifecycle.hrms_service_book_entries ADD COLUMN IF NOT EXISTS attest_remarks TEXT;

------------------------------------------------------------------------------
-- 3. RTI request register (HR)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifecycle.hrms_rti_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  reference_no    VARCHAR(64) NOT NULL,
  applicant_name  TEXT NOT NULL,
  applicant_contact TEXT,
  subject         TEXT NOT NULL,
  request_text    TEXT NOT NULL,
  received_date   DATE NOT NULL,
  due_date        DATE NOT NULL,           -- 30-day RTI SLA from received_date
  pio_id          UUID,                    -- assigned Public Information Officer
  status          VARCHAR(24) NOT NULL DEFAULT 'filed',  -- filed|assigned|responded|appealed|closed
  response_text   TEXT,
  responded_date  DATE,
  appeal_text     TEXT,
  appeal_date     DATE,
  closed_date     DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rti_ref ON lifecycle.hrms_rti_requests(tenant_id, reference_no);
CREATE INDEX IF NOT EXISTS idx_rti_status ON lifecycle.hrms_rti_requests(tenant_id, status, due_date);

------------------------------------------------------------------------------
-- 4. LMS completion records (training nominations -> completion feeding service book)
------------------------------------------------------------------------------
ALTER TABLE training.hrms_nominations ADD COLUMN IF NOT EXISTS completed_date DATE;
ALTER TABLE training.hrms_nominations ADD COLUMN IF NOT EXISTS score          INTEGER;
ALTER TABLE training.hrms_nominations ADD COLUMN IF NOT EXISTS result         VARCHAR(16);  -- pass|fail
