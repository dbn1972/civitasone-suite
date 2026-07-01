-- 0027: ERP Organisational Structure — Legal Entity, Cost Center, Profit Center, Operating Unit.
--
-- Follows SAP S/4HANA Company Code / Oracle Fusion Legal Entity pattern:
-- - Legal Entity = independent accounting unit (own CoA, balance sheet, GST reg, bank accounts)
-- - Operating Unit = branch/plant that transacts under a Legal Entity
-- - Cost Center = budget allocation/control point (tree)
-- - Profit Center = P&L responsibility centre (tree, PSU/private)
--
-- These sit BETWEEN tenant (group) and department (admin unit), enabling:
--   Group Company → Legal Entities → Operating Units → Departments
--
-- For Government: Legal Entity ≈ DDO/PAO (each DDO files separate bills/vouchers)
-- For PSU: Legal Entity ≈ subsidiary company
-- For Private: Legal Entity ≈ each registered company in the group
--
-- Additive, idempotent, forward-only.

CREATE SCHEMA IF NOT EXISTS org;

-- ═══════════════════════════════════════════════════════════════════════════
-- LEGAL ENTITY (SAP Company Code / Oracle Legal Entity)
-- An independent accounting unit with its own Chart of Accounts, balance sheet,
-- P&L, bank accounts, and tax registrations (GST/TAN/PAN).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS org.legal_entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  code            TEXT NOT NULL,                     -- short code (e.g. "NTPC-VIN", "DDO-0142")
  name            TEXT NOT NULL,                     -- full legal name
  entity_type     TEXT NOT NULL DEFAULT 'company',   -- company|subsidiary|ddo|pao|branch_office|trust|society
  parent_entity_id UUID,                             -- group → subsidiary hierarchy
  -- Tax registrations
  gstin           TEXT,                              -- GST identification number (15-char)
  pan             TEXT,                              -- PAN of the entity
  tan             TEXT,                              -- TAN for TDS
  cin             TEXT,                              -- Corporate Identity Number (companies)
  -- Financial configuration
  currency        CHAR(3) NOT NULL DEFAULT 'INR',    -- functional currency (ISO 4217)
  fiscal_year_start TEXT NOT NULL DEFAULT '04-01',   -- MM-DD (India: April)
  coa_id          UUID,                              -- Chart of Accounts reference
  -- Government-specific (DDO/PAO mapping)
  ddo_code        TEXT,                              -- Drawing & Disbursing Officer code
  pao_code        TEXT,                              -- Pay & Accounts Officer code
  treasury_code   TEXT,                              -- Treasury/Sub-Treasury code
  -- Physical location
  location_id     UUID,                              -- cross-service ref to location-service
  registered_address TEXT,
  -- Status
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,                              -- null = currently active
  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_entity_code ON org.legal_entities (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_legal_entity_parent ON org.legal_entities (tenant_id, parent_entity_id);
CREATE INDEX IF NOT EXISTS idx_legal_entity_active ON org.legal_entities (tenant_id, is_active);

-- ═══════════════════════════════════════════════════════════════════════════
-- OPERATING UNIT (SAP Plant / Oracle Business Unit)
-- A transactional unit that operates UNDER a legal entity. Each operating
-- unit processes transactions (purchases, sales, inventory) on behalf of its
-- legal entity. Maps to physical location (branch/plant/office).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS org.operating_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  legal_entity_id UUID NOT NULL,                     -- belongs to this legal entity
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  unit_type       TEXT NOT NULL DEFAULT 'branch',    -- branch|plant|warehouse|office|depot|regional_office
  location_id     UUID,                              -- cross-service ref to location-service
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_unit_code ON org.operating_units (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_operating_unit_le ON org.operating_units (tenant_id, legal_entity_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- COST CENTER (SAP Cost Center / Budget control point)
-- Hierarchical: Division cost center → departmental cost center → section cost center.
-- Every financial transaction (voucher, purchase, salary) posts against a cost center.
-- This is WHERE the money is spent.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS org.cost_centers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  legal_entity_id UUID NOT NULL,                     -- belongs to this legal entity
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  parent_id       UUID,                              -- hierarchy (division → dept → section)
  department_id   UUID,                              -- cross-service ref to hrms_departments
  manager_id      UUID,                              -- responsible person (employee ref)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_center_code ON org.cost_centers (tenant_id, legal_entity_id, code);
CREATE INDEX IF NOT EXISTS idx_cost_center_parent ON org.cost_centers (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_cost_center_dept ON org.cost_centers (tenant_id, department_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PROFIT CENTER (SAP Profit Center / P&L responsibility)
-- Used by PSU and private companies for divisional P&L reporting.
-- Government edition may leave this unused (budget-driven, not P&L-driven).
-- This is WHO is responsible for the profit/loss.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS org.profit_centers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  legal_entity_id UUID NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  parent_id       UUID,                              -- hierarchy
  segment         TEXT,                              -- business segment for segment reporting
  manager_id      UUID,                              -- P&L owner
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_profit_center_code ON org.profit_centers (tenant_id, legal_entity_id, code);
CREATE INDEX IF NOT EXISTS idx_profit_center_parent ON org.profit_centers (tenant_id, parent_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- GRANTs — finance_svc role needs full CRUD on the org schema.
-- ═══════════════════════════════════════════════════════════════════════════
GRANT USAGE ON SCHEMA org TO finance_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA org TO finance_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA org GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finance_svc;
