-- 0012: P1 closure for payroll-service.
-- (1) TDS challan ingestion + reconciliation, (2) FY-versioned tax config,
-- (3) itemised Form 12BA perquisite components, (4) Form 26Q non-salary TDS.
-- Additive + idempotent only.

-- ===========================================================================
-- P1.1  TDS CHALLAN  (BSR / CIN / deposit date / amount) for TRACES reconcil.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS statutory.payroll_tds_challan (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  -- The period the challan covers (YYYY-MM). Reconciliation sums payroll_tds for
  -- the same tenant+period against deposited challans.
  period             CHAR(7) NOT NULL,
  -- Section under which TDS deposited: 192 (salary/24Q) or non-salary (26Q).
  section            VARCHAR(8) NOT NULL DEFAULT '192',
  form_type          VARCHAR(4) NOT NULL DEFAULT '24Q',  -- 24Q | 26Q
  bsr_code           VARCHAR(7) NOT NULL,                -- 7-digit RBI BSR code of the bank
  challan_serial     VARCHAR(16) NOT NULL,               -- challan serial no.
  deposit_date       DATE NOT NULL,                      -- date of deposit (DDMMYYYY on challan)
  -- CIN = BSR(7) + DDMMYYYY(8) + serial(5) per NSDL. Stored explicitly too.
  cin                VARCHAR(32) NOT NULL,
  tds_amount_minor   BIGINT NOT NULL DEFAULT 0,          -- TDS portion deposited (paise)
  total_amount_minor BIGINT NOT NULL DEFAULT 0,          -- total challan incl. interest/fee (paise)
  interest_minor     BIGINT NOT NULL DEFAULT 0,
  fee_minor          BIGINT NOT NULL DEFAULT 0,
  status             VARCHAR(16) NOT NULL DEFAULT 'ingested',  -- ingested | reconciled
  currency           CHAR(3) NOT NULL DEFAULT 'INR',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1
);

-- A CIN is unique per tenant (a challan cannot be ingested twice). Idempotent ingest.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_tds_challan_tenant_cin
  ON statutory.payroll_tds_challan (tenant_id, cin);
CREATE INDEX IF NOT EXISTS ix_payroll_tds_challan_tenant_period
  ON statutory.payroll_tds_challan (tenant_id, period, form_type);

-- ===========================================================================
-- P1.2  FY-VERSIONED TAX CONFIG  (slabs / surcharge / rebate / std deduction)
-- ===========================================================================
-- One row per (fy_start_year, regime). slabs is a JSON array of {from,to,rate};
-- "to": null means Infinity (top slab). Reject unknown FY = absence of rows.
CREATE TABLE IF NOT EXISTS payroll.tax_slab_config (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_start_year        INTEGER NOT NULL,
  regime               VARCHAR(4) NOT NULL,              -- old | new
  slabs                JSONB NOT NULL,                   -- [{from,to,rate}]
  std_deduction        BIGINT NOT NULL DEFAULT 0,        -- rupees
  rebate_income_cap    BIGINT NOT NULL DEFAULT 0,        -- 87A: taxable<=cap -> rebate
  rebate_max           BIGINT NOT NULL DEFAULT 0,        -- 87A: max rebate amount (rupees)
  surcharge_bands      JSONB NOT NULL,                   -- [{above,rate}] rupees thresholds
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_slab_config_fy_regime
  ON payroll.tax_slab_config (fy_start_year, regime);

-- Seed FY 2024-25, 2025-26 (existing behaviour) and NEW FY 2026-27.
-- new-regime surcharge top band capped at 25%; old-regime tops at 37%.
INSERT INTO payroll.tax_slab_config
  (fy_start_year, regime, slabs, std_deduction, rebate_income_cap, rebate_max, surcharge_bands)
VALUES
  -- FY 2024-25 new
  (2024, 'new',
   '[{"from":0,"to":300000,"rate":0},{"from":300000,"to":700000,"rate":0.05},{"from":700000,"to":1000000,"rate":0.10},{"from":1000000,"to":1200000,"rate":0.15},{"from":1200000,"to":1500000,"rate":0.20},{"from":1500000,"to":null,"rate":0.30}]',
   75000, 700000, 25000,
   '[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15},{"above":20000000,"rate":0.25},{"above":50000000,"rate":0.25}]'),
  -- FY 2025-26 new
  (2025, 'new',
   '[{"from":0,"to":400000,"rate":0},{"from":400000,"to":800000,"rate":0.05},{"from":800000,"to":1200000,"rate":0.10},{"from":1200000,"to":1600000,"rate":0.15},{"from":1600000,"to":2000000,"rate":0.20},{"from":2000000,"to":2400000,"rate":0.25},{"from":2400000,"to":null,"rate":0.30}]',
   75000, 1200000, 60000,
   '[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15},{"above":20000000,"rate":0.25},{"above":50000000,"rate":0.25}]'),
  -- FY 2026-27 new  (NEW — carries forward the 2025-26 structure as current law)
  (2026, 'new',
   '[{"from":0,"to":400000,"rate":0},{"from":400000,"to":800000,"rate":0.05},{"from":800000,"to":1200000,"rate":0.10},{"from":1200000,"to":1600000,"rate":0.15},{"from":1600000,"to":2000000,"rate":0.20},{"from":2000000,"to":2400000,"rate":0.25},{"from":2400000,"to":null,"rate":0.30}]',
   75000, 1200000, 60000,
   '[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15},{"above":20000000,"rate":0.25},{"above":50000000,"rate":0.25}]'),
  -- OLD regime (stable across these FYs)
  (2024, 'old',
   '[{"from":0,"to":250000,"rate":0},{"from":250000,"to":500000,"rate":0.05},{"from":500000,"to":1000000,"rate":0.20},{"from":1000000,"to":null,"rate":0.30}]',
   50000, 500000, 12500,
   '[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15},{"above":20000000,"rate":0.25},{"above":50000000,"rate":0.37}]'),
  (2025, 'old',
   '[{"from":0,"to":250000,"rate":0},{"from":250000,"to":500000,"rate":0.05},{"from":500000,"to":1000000,"rate":0.20},{"from":1000000,"to":null,"rate":0.30}]',
   50000, 500000, 12500,
   '[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15},{"above":20000000,"rate":0.25},{"above":50000000,"rate":0.37}]'),
  (2026, 'old',
   '[{"from":0,"to":250000,"rate":0},{"from":250000,"to":500000,"rate":0.05},{"from":500000,"to":1000000,"rate":0.20},{"from":1000000,"to":null,"rate":0.30}]',
   50000, 500000, 12500,
   '[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15},{"above":20000000,"rate":0.25},{"above":50000000,"rate":0.37}]')
ON CONFLICT (fy_start_year, regime) DO NOTHING;

-- ===========================================================================
-- P1.3  FORM 12BA PERQUISITE COMPONENTS  (itemised per Sec 17(2))
-- ===========================================================================
CREATE TABLE IF NOT EXISTS payroll.perquisite_components (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  employee_id        UUID NOT NULL,
  fy                 CHAR(7) NOT NULL,
  -- 12BA serial nature, e.g. 'accommodation','car','interest_free_loan','esop'...
  nature             VARCHAR(64) NOT NULL,
  -- statutory free-text description rendered in the 12BA table
  description        VARCHAR(255) NOT NULL DEFAULT '',
  value_by_employer_minor   BIGINT NOT NULL DEFAULT 0,   -- col (3) value of perquisite
  amount_recovered_minor    BIGINT NOT NULL DEFAULT 0,   -- col (4) amount recovered from employee
  -- taxable value col (5) = value_by_employer - amount_recovered (stored explicitly)
  taxable_value_minor       BIGINT NOT NULL DEFAULT 0,
  currency           CHAR(3) NOT NULL DEFAULT 'INR',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perquisite_components_emp_fy
  ON payroll.perquisite_components (tenant_id, employee_id, fy);
-- One row per (employee, fy, nature) so re-ingesting a perquisite line updates it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_perquisite_components_emp_fy_nature
  ON payroll.perquisite_components (tenant_id, employee_id, fy, nature);

-- ===========================================================================
-- P1.4  FORM 26Q NON-SALARY TDS  (contractors / professionals / rent)
-- ===========================================================================
-- Scaffold: population requires a non-salary deduction feed (AP / vendor / rent
-- payments). Endpoint reads this table to emit a well-formed 26Q.
CREATE TABLE IF NOT EXISTS statutory.payroll_tds_nonsalary (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  period             CHAR(7) NOT NULL,                   -- YYYY-MM of deduction
  -- deductee (vendor/contractor/landlord) identity
  deductee_ref       VARCHAR(64) NOT NULL,               -- vendor/payee id from feed
  deductee_name      VARCHAR(255) NOT NULL DEFAULT '',
  deductee_pan       VARCHAR(10) NOT NULL DEFAULT '',
  -- 26Q section code: 194C (contractor), 194J (professional), 194I (rent)...
  section            VARCHAR(8) NOT NULL,
  paid_amount_minor  BIGINT NOT NULL DEFAULT 0,          -- amount paid/credited (paise)
  tds_rate_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
  tds_amount_minor   BIGINT NOT NULL DEFAULT 0,          -- TDS deducted (paise)
  deduction_date     DATE,
  currency           CHAR(3) NOT NULL DEFAULT 'INR',
  source_feed        VARCHAR(32) NOT NULL DEFAULT 'manual', -- which feed populated this
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payroll_tds_nonsalary_tenant_period
  ON statutory.payroll_tds_nonsalary (tenant_id, period, section);
