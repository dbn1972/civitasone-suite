-- finance-service: Re-appropriation as a ZERO-SUM transfer (GFR Rule 10).
-- Additive, idempotent, forward-only.
--
-- R4 fix: a re-appropriation moves an amount FROM a source head's savings TO a
-- target head. Previously only the target budget's re_minor was set (funds
-- materialised from nowhere, and the change was wrongly capped at BE). We now
-- record the source budget so the consumer can debit the source and credit the
-- target in one transaction — total appropriation is conserved.
--
-- `amount_minor` now carries the TRANSFER amount (paise) moved from source to
-- target, NOT the new revised-estimate target.

ALTER TABLE budget.finance_reappropriations
  ADD COLUMN IF NOT EXISTS from_budget_id uuid;

CREATE INDEX IF NOT EXISTS idx_freappropriations_from_budget
  ON budget.finance_reappropriations(from_budget_id);
