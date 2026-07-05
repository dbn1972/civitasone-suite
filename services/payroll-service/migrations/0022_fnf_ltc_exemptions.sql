-- 0022: Full & Final settlement, LTC exemption tracking, and exemption ceiling config
-- Addresses ADP parity gap: separation tax exemptions + LTC Sec 10(5) integration

-- ── F&F settlement records (one per separated employee) ─────────────────────
CREATE TABLE IF NOT EXISTS payroll.fnf_settlements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  employee_id                 uuid NOT NULL,
  run_id                      uuid,
  separation_type             varchar(24) NOT NULL,
  separation_date             date NOT NULL,
  employee_category           varchar(24) NOT NULL DEFAULT 'non_govt_covered',
  -- Gross amounts (paise)
  notice_buyout_minor         bigint NOT NULL DEFAULT 0,
  leave_encashment_gross_minor bigint NOT NULL DEFAULT 0,
  gratuity_gross_minor        bigint NOT NULL DEFAULT 0,
  retrenchment_comp_minor     bigint NOT NULL DEFAULT 0,
  vrs_comp_minor              bigint NOT NULL DEFAULT 0,
  arrears_minor               bigint NOT NULL DEFAULT 0,
  -- Exemptions computed
  gratuity_exempt_minor       bigint NOT NULL DEFAULT 0,
  leave_encash_exempt_minor   bigint NOT NULL DEFAULT 0,
  retrenchment_exempt_minor   bigint NOT NULL DEFAULT 0,
  vrs_exempt_minor            bigint NOT NULL DEFAULT 0,
  -- Tax
  total_taxable_minor         bigint NOT NULL DEFAULT 0,
  tds_on_separation_minor     bigint NOT NULL DEFAULT 0,
  net_payable_minor           bigint NOT NULL DEFAULT 0,
  -- Metadata
  computation_detail          jsonb,
  status                      varchar(16) NOT NULL DEFAULT 'draft',
  currency                    char(3) NOT NULL DEFAULT 'INR',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL,
  updated_by                  uuid NOT NULL,
  version                     integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_fnf_settlements_employee
  ON payroll.fnf_settlements(tenant_id, employee_id);

-- ── LTC exemption tracking for monthly TDS adjustment ────────────────────────
CREATE TABLE IF NOT EXISTS payroll.ltc_exemptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  employee_id         uuid NOT NULL,
  fy                  char(7) NOT NULL,
  claim_id            uuid NOT NULL,
  block_year          varchar(16) NOT NULL,
  ltc_type            varchar(16) NOT NULL,
  approved_fare_minor bigint NOT NULL,
  exempt_amount_minor bigint NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ltc_exemptions_emp_fy
  ON payroll.ltc_exemptions(tenant_id, employee_id, fy);

-- ── Exemption ceiling config (per FY, amendable) ─────────────────────────────
CREATE TABLE IF NOT EXISTS payroll.exemption_ceilings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fy_start_year     integer NOT NULL,
  section           varchar(16) NOT NULL,
  ceiling_minor     bigint NOT NULL,
  notes             varchar(512),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fy_start_year, section)
);

-- Seed defaults (idempotent)
INSERT INTO payroll.exemption_ceilings (id, fy_start_year, section, ceiling_minor, notes)
VALUES
  (gen_random_uuid(), 2024, '10_10',   2000000000, 'Gratuity ₹20L w.e.f. 29-Mar-2018'),
  (gen_random_uuid(), 2024, '10_10AA', 2500000000, 'Leave encashment ₹25L w.e.f. AY 2024-25'),
  (gen_random_uuid(), 2024, '10_10B',  500000000,  'Retrenchment ₹5L'),
  (gen_random_uuid(), 2024, '10_10C',  500000000,  'VRS ₹5L'),
  (gen_random_uuid(), 2025, '10_10',   2000000000, 'Gratuity ₹20L'),
  (gen_random_uuid(), 2025, '10_10AA', 2500000000, 'Leave encashment ₹25L'),
  (gen_random_uuid(), 2025, '10_10B',  500000000,  'Retrenchment ₹5L'),
  (gen_random_uuid(), 2025, '10_10C',  500000000,  'VRS ₹5L')
ON CONFLICT (fy_start_year, section) DO NOTHING;
