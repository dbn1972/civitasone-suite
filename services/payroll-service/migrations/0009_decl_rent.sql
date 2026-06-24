-- Wire Sec 10(13A) HRA exemption: capture annual rent paid in the declaration.
ALTER TABLE payroll.payroll_tax_declarations
  ADD COLUMN IF NOT EXISTS rent_paid_minor bigint NOT NULL DEFAULT 0;
