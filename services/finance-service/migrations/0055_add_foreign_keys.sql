-- DB-B1: Add foreign key constraints (none existed database-wide)
SET lock_timeout = '5s';

DO $$ BEGIN
  ALTER TABLE payments.finance_bills
    ADD CONSTRAINT fk_fbills_head FOREIGN KEY (head_id)
    REFERENCES budget.finance_heads (id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE payments.finance_bills VALIDATE CONSTRAINT fk_fbills_head;

DO $$ BEGIN
  ALTER TABLE payments.finance_payments
    ADD CONSTRAINT fk_fpayments_bill FOREIGN KEY (bill_id)
    REFERENCES payments.finance_bills (id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE payments.finance_payments VALIDATE CONSTRAINT fk_fpayments_bill;

DO $$ BEGIN
  ALTER TABLE gl.finance_journal_lines
    ADD CONSTRAINT fk_jlines_journal FOREIGN KEY (journal_id)
    REFERENCES gl.finance_journals (id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE gl.finance_journal_lines VALIDATE CONSTRAINT fk_jlines_journal;

DO $$ BEGIN
  ALTER TABLE budget.finance_budgets
    ADD CONSTRAINT fk_fbudgets_head FOREIGN KEY (head_id)
    REFERENCES budget.finance_heads (id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE budget.finance_budgets VALIDATE CONSTRAINT fk_fbudgets_head;

DO $$ BEGIN
  ALTER TABLE budget.finance_budget_allocation
    ADD CONSTRAINT fk_falloc_head FOREIGN KEY (head_id)
    REFERENCES budget.finance_heads (id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE budget.finance_budget_allocation VALIDATE CONSTRAINT fk_falloc_head;

DO $$ BEGIN
  ALTER TABLE payments.finance_payments
    ADD CONSTRAINT fk_fpayments_bank FOREIGN KEY (bank_account_id)
    REFERENCES treasury.finance_banks (id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE payments.finance_payments VALIDATE CONSTRAINT fk_fpayments_bank;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gl' AND table_name='finance_journals' AND column_name='reverses_id') THEN
    BEGIN
      ALTER TABLE gl.finance_journals ADD CONSTRAINT fk_fjournals_reverses FOREIGN KEY (reverses_id) REFERENCES gl.finance_journals (id) NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT fk_fjournals_reverses;
  END IF;
END $$;
