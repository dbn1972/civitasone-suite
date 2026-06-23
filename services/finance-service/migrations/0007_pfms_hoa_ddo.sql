-- P3: PFMS HoA 18-digit coding + DDO code on bills/payments

ALTER TABLE budget.finance_heads
  ADD COLUMN IF NOT EXISTS hoa_code char(18);

ALTER TABLE budget.finance_heads
  DROP CONSTRAINT IF EXISTS chk_finance_heads_hoa_code;

ALTER TABLE budget.finance_heads
  ADD CONSTRAINT chk_finance_heads_hoa_code
  CHECK (hoa_code IS NULL OR hoa_code ~ '^\d{18}$');

ALTER TABLE payments.finance_bills
  ADD COLUMN IF NOT EXISTS ddo_code varchar(12);

ALTER TABLE payments.finance_bills
  DROP CONSTRAINT IF EXISTS chk_finance_bills_ddo_code;

ALTER TABLE payments.finance_bills
  ADD CONSTRAINT chk_finance_bills_ddo_code
  CHECK (ddo_code IS NULL OR ddo_code ~ '^[A-Za-z0-9]{6,12}$');

ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS ddo_code varchar(12);

ALTER TABLE payments.finance_payments
  DROP CONSTRAINT IF EXISTS chk_finance_payments_ddo_code;

ALTER TABLE payments.finance_payments
  ADD CONSTRAINT chk_finance_payments_ddo_code
  CHECK (ddo_code IS NULL OR ddo_code ~ '^[A-Za-z0-9]{6,12}$');

-- Seed PFMS HoA codes for demo tenant heads (salaries 2071…, capital 3001…)
UPDATE budget.finance_heads SET hoa_code = '207101010101010101'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = '6002' AND hoa_code IS NULL;

UPDATE budget.finance_heads SET hoa_code = '207101010101010102'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = '6001' AND hoa_code IS NULL;

UPDATE budget.finance_heads SET hoa_code = '404601010101010101'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = '4001' AND hoa_code IS NULL;

UPDATE budget.finance_heads SET hoa_code = '404601010101010102'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = '4002' AND hoa_code IS NULL;

UPDATE budget.finance_heads SET hoa_code = '300101010101010101'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = '3001' AND hoa_code IS NULL;

UPDATE budget.finance_heads SET hoa_code = '300101010101010102'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND code = '3002' AND hoa_code IS NULL;
