-- Migration 0010: HoA major-head master, PAO/DDO masters, gapless voucher counters
-- Additive + idempotent only.

-- ============================================================
-- 1. Major Head master (CGA 4-digit major heads)
-- ============================================================
CREATE TABLE IF NOT EXISTS budget.finance_major_heads (
  code        char(4) PRIMARY KEY,
  description text    NOT NULL,
  sector      varchar(16) NOT NULL DEFAULT 'General'
              CHECK (sector IN ('General','Social','Economic','GrantsInAid','PublicDebt','Tax','NonTax')),
  account_type varchar(24) NOT NULL DEFAULT 'expenditure'
              CHECK (account_type IN ('revenue_receipt','capital_receipt','revenue_expenditure','capital_expenditure','expenditure','loan')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_major_head_code CHECK (code ~ '^\d{4}$')
);

-- Idempotent widen (table may pre-exist from an earlier apply)
ALTER TABLE budget.finance_major_heads
  ALTER COLUMN account_type TYPE varchar(24);

-- Seed real CGA major heads
INSERT INTO budget.finance_major_heads (code, description, sector, account_type) VALUES
  ('0029', 'Land Revenue', 'Tax', 'revenue_receipt'),
  ('0020', 'Corporation Tax', 'Tax', 'revenue_receipt'),
  ('0021', 'Taxes on Income other than Corporation Tax', 'Tax', 'revenue_receipt'),
  ('0040', 'Taxes on Sales, Trade etc.', 'Tax', 'revenue_receipt'),
  ('2011', 'Parliament/State/Union Territory Legislatures', 'General', 'revenue_expenditure'),
  ('2012', 'President, Vice-President/Governor, Administrator of Union Territories', 'General', 'revenue_expenditure'),
  ('2013', 'Council of Ministers', 'General', 'revenue_expenditure'),
  ('2014', 'Administration of Justice', 'General', 'revenue_expenditure'),
  ('2015', 'Elections', 'General', 'revenue_expenditure'),
  ('2052', 'Secretariat-General Services', 'General', 'revenue_expenditure'),
  ('2055', 'Police', 'General', 'revenue_expenditure'),
  ('2070', 'Other Administrative Services', 'General', 'revenue_expenditure'),
  ('2071', 'Pensions and Other Retirement Benefits', 'General', 'revenue_expenditure'),
  ('2202', 'General Education', 'Social', 'revenue_expenditure'),
  ('2210', 'Medical and Public Health', 'Social', 'revenue_expenditure'),
  ('2211', 'Family Welfare', 'Social', 'revenue_expenditure'),
  ('2215', 'Water Supply and Sanitation', 'Social', 'revenue_expenditure'),
  ('2225', 'Welfare of SCs, STs, OBCs and Minorities', 'Social', 'revenue_expenditure'),
  ('2235', 'Social Security and Welfare', 'Social', 'revenue_expenditure'),
  ('2401', 'Crop Husbandry', 'Economic', 'revenue_expenditure'),
  ('2501', 'Special Programmes for Rural Development', 'Economic', 'revenue_expenditure'),
  ('2701', 'Major and Medium Irrigation', 'Economic', 'revenue_expenditure'),
  ('2801', 'Power', 'Economic', 'revenue_expenditure'),
  ('3054', 'Roads and Bridges', 'Economic', 'revenue_expenditure'),
  ('3601', 'Grants-in-aid to State Governments', 'GrantsInAid', 'revenue_expenditure'),
  ('3602', 'Grants-in-aid to Union Territory Governments', 'GrantsInAid', 'revenue_expenditure'),
  ('4046', 'Capital Outlay on Currency, Coinage and Mint', 'General', 'capital_expenditure'),
  ('4055', 'Capital Outlay on Police', 'General', 'capital_expenditure'),
  ('4202', 'Capital Outlay on Education, Sports, Art and Culture', 'Social', 'capital_expenditure'),
  ('4210', 'Capital Outlay on Medical and Public Health', 'Social', 'capital_expenditure'),
  ('4700', 'Capital Outlay on Major Irrigation', 'Economic', 'capital_expenditure'),
  ('5054', 'Capital Outlay on Roads and Bridges', 'Economic', 'capital_expenditure'),
  ('3001', 'Capital Account (legacy/internal)', 'General', 'capital_expenditure')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. PAO master (Pay & Accounts Office)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments.finance_pao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  pao_code    varchar(12) NOT NULL,
  name        text NOT NULL,
  ministry    text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pao_code CHECK (pao_code ~ '^[A-Za-z0-9]{4,12}$'),
  UNIQUE (tenant_id, pao_code)
);
CREATE INDEX IF NOT EXISTS idx_pao_tenant ON payments.finance_pao(tenant_id);

-- ============================================================
-- 3. DDO master (Drawing & Disbursing Officer)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments.finance_ddo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  ddo_code    varchar(12) NOT NULL,
  name        text NOT NULL,
  pao_code    varchar(12),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ddo_code CHECK (ddo_code ~ '^[A-Za-z0-9]{6,12}$'),
  UNIQUE (tenant_id, ddo_code)
);
CREATE INDEX IF NOT EXISTS idx_ddo_tenant ON payments.finance_ddo(tenant_id);

-- Seed PAO + DDO for demo tenant (matches existing pfms default_ddo DDO123456)
INSERT INTO payments.finance_pao (tenant_id, pao_code, name, ministry) VALUES
  ('00000000-0000-0000-0000-000000000001', 'PAO001', 'Pay & Accounts Office (Main)', 'Ministry of Finance')
ON CONFLICT (tenant_id, pao_code) DO NOTHING;

INSERT INTO payments.finance_ddo (tenant_id, ddo_code, name, pao_code) VALUES
  ('00000000-0000-0000-0000-000000000001', 'DDO123456', 'Drawing & Disbursing Officer (Secretariat)', 'PAO001')
ON CONFLICT (tenant_id, ddo_code) DO NOTHING;

-- Bills/payments: add pao_code alongside existing ddo_code
ALTER TABLE payments.finance_bills
  ADD COLUMN IF NOT EXISTS pao_code varchar(12);
ALTER TABLE payments.finance_bills
  DROP CONSTRAINT IF EXISTS chk_finance_bills_pao_code;
ALTER TABLE payments.finance_bills
  ADD CONSTRAINT chk_finance_bills_pao_code
  CHECK (pao_code IS NULL OR pao_code ~ '^[A-Za-z0-9]{4,12}$');

ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS pao_code varchar(12);
ALTER TABLE payments.finance_payments
  DROP CONSTRAINT IF EXISTS chk_finance_payments_pao_code;
ALTER TABLE payments.finance_payments
  ADD CONSTRAINT chk_finance_payments_pao_code
  CHECK (pao_code IS NULL OR pao_code ~ '^[A-Za-z0-9]{4,12}$');

ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS pao_code varchar(12);

-- ============================================================
-- 4. Gapless voucher counter (per tenant + FY + series)
-- ============================================================
CREATE TABLE IF NOT EXISTS gl.finance_voucher_counter (
  tenant_id   uuid NOT NULL,
  fy          char(7) NOT NULL,
  series      varchar(16) NOT NULL DEFAULT 'JV',
  last_seq    bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, fy, series)
);
