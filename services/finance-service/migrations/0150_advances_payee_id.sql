-- 0150_advances_payee_id.sql
-- GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03: an advance is issued TO someone, and the register used to keep only a
-- typed display name (beneficiary). The new-advance form now picks the payee from a master list, so the id of the
-- picked record is stored next to the name:
--   type = 'employee' -> the employee id from the payroll employee lookup (an OPAQUE reference: the employee master
--                        lives in another service, so there is deliberately no foreign key, per L2 / CLAUDE.md rule 13)
--   type = 'vendor'   -> payments.finance_vendors.id of the same tenant (checked by the route; no FK either, to match
--                        finance_bills.vendor_id, see 0065)
--   type = 'other'    -> NULL (an "other" payee has no master record)
-- NULL for every existing advance and for any advance created without a picked payee: additive and behaviourally inert.
-- The id is NOT returned by GET /v1/finance/advances (it identifies a natural person for employee advances).
-- Idempotent. Safe to re-run.
-- Rollback: ALTER TABLE payments.finance_advances DROP COLUMN IF EXISTS payee_id;

SET lock_timeout = '5s';

ALTER TABLE payments.finance_advances ADD COLUMN IF NOT EXISTS payee_id uuid;

COMMENT ON COLUMN payments.finance_advances.payee_id IS
  'Opaque id of the picked payee (employee id for type=employee, payments.finance_vendors.id for type=vendor); NULL when the payee was typed or the type is other. No FK by design.';
