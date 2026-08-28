-- 0017: Digital ID Card Module
-- Covers: employees, vendor/outsourced staff, contractor project teams
-- HR issues → employee shows QR at gate → security verifies via scan

-- 2026-08-27: schema "hrms" never existed in this database (which uses per-domain
-- schemas like employee/leave/disciplinary, not a literal hrms schema) --
-- CREATE TABLE hrms.id_cards below always failed with "schema does not exist",
-- silently, because migrate-all.mjs runs psql without ON_ERROR_STOP. Application
-- code (routes.ts) also hardcodes hrms.id_cards, so creating the schema is the
-- correct fix rather than renaming to match the domain-schema convention.
CREATE SCHEMA IF NOT EXISTS hrms;

-- Card types: employee (permanent), contractual, vendor_staff, project_team, intern, visitor
CREATE TABLE IF NOT EXISTS hrms.id_cards (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  -- Person details (may not be an employee for vendor staff)
  holder_name TEXT NOT NULL,
  holder_photo_url TEXT,
  designation TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  employee_id UUID, -- NULL for vendor/external staff
  employee_code TEXT,
  -- Card metadata
  card_type TEXT NOT NULL DEFAULT 'employee' CHECK (card_type IN ('employee', 'contractual', 'vendor_staff', 'project_team', 'intern', 'visitor')),
  card_number TEXT NOT NULL, -- e.g. DIC/2026/00145
  -- Vendor/project linkage (for non-employee cards)
  vendor_id UUID, -- references procurement vendor
  vendor_name TEXT,
  project_id UUID,
  project_name TEXT,
  contract_id UUID,
  -- Validity
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended', 'expired', 'revoked')),
  -- Access control
  access_zones TEXT[] NOT NULL DEFAULT '{}', -- e.g. {'main_gate', 'floor_3', 'server_room'}
  access_hours TEXT NOT NULL DEFAULT '09:00-18:00', -- allowed time window
  -- Security
  qr_payload TEXT NOT NULL, -- encrypted payload for QR verification
  verification_count INT NOT NULL DEFAULT 0,
  last_verified_at TIMESTAMPTZ,
  last_verified_by UUID,
  -- Lifecycle
  issued_by UUID NOT NULL,
  issued_by_name TEXT NOT NULL DEFAULT '',
  revoked_by UUID,
  revoked_reason TEXT,
  revoked_at TIMESTAMPTZ,
  -- Standard fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, card_number)
);

CREATE INDEX idx_id_cards_tenant_holder ON hrms.id_cards (tenant_id, holder_name);
CREATE INDEX idx_id_cards_tenant_type ON hrms.id_cards (tenant_id, card_type, status);
CREATE INDEX idx_id_cards_employee ON hrms.id_cards (tenant_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX idx_id_cards_vendor ON hrms.id_cards (tenant_id, vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX idx_id_cards_qr ON hrms.id_cards (qr_payload);

-- Verification log — every time a card is scanned at a gate
CREATE TABLE IF NOT EXISTS hrms.id_card_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  card_id UUID NOT NULL REFERENCES hrms.id_cards(id),
  verified_by UUID NOT NULL, -- security guard user ID
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  location TEXT NOT NULL DEFAULT '', -- gate/checkpoint name
  result TEXT NOT NULL DEFAULT 'valid' CHECK (result IN ('valid', 'expired', 'suspended', 'revoked', 'unknown')),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION
);

CREATE INDEX idx_verifications_card ON hrms.id_card_verifications (card_id, verified_at DESC);
CREATE INDEX idx_verifications_tenant ON hrms.id_card_verifications (tenant_id, verified_at DESC);
