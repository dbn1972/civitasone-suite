-- B1: prevent over-adjustment of advances at the DB level
ALTER TABLE payments.finance_advances
  ADD CONSTRAINT chk_advance_adjusted_lte_amount
  CHECK (adjusted_minor <= amount_minor);
