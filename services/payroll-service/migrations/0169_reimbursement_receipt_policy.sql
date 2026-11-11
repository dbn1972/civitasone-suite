-- 0169_reimbursement_receipt_policy.sql
-- Configurable receipt rule for reimbursement claims.
--
-- 1) payroll.payroll_settings.reimbursement_receipt_policy (nullable jsonb):
--      { "categories": { "<category>": {
--          "mode": "always" | "never" | "above_amount",
--          "thresholdMinor": <int > 0>          -- only for above_amount (receipt needed when amount > threshold)
--          "selfDeclarationUpToMinor": <int > 0> -- optional; a signed self-declaration may stand in for the
--                                                   receipt when the amount is <= this (mode always/above_amount)
--      } } }
--    NULL (and any category not listed) means the application default, which
--    is exactly the behaviour before this migration: medical, lta and travel
--    need a receipt, every other category does not. No backfill, so this is a
--    no-op for existing tenants until an admin saves a policy.
-- 2) payroll.payroll_reimbursements records HOW each claim was supported:
--      receipt_basis = 'receipt' | 'self_declaration' | 'not_required'
--    plus who signed the self-declaration and when.
--
-- Additive and idempotent. RLS on both tables already exists (0036); re-asserted.
-- Rollback:
--   ALTER TABLE payroll.payroll_reimbursements DROP CONSTRAINT IF EXISTS payroll_reimbursements_receipt_basis_chk,
--     DROP COLUMN IF EXISTS receipt_basis, DROP COLUMN IF EXISTS self_declared_by, DROP COLUMN IF EXISTS self_declared_at;
--   ALTER TABLE payroll.payroll_settings DROP CONSTRAINT IF EXISTS payroll_settings_reimbursement_receipt_policy_chk,
--     DROP COLUMN IF EXISTS reimbursement_receipt_policy;
SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS reimbursement_receipt_policy jsonb;

ALTER TABLE payroll.payroll_settings
  DROP CONSTRAINT IF EXISTS payroll_settings_reimbursement_receipt_policy_chk;
ALTER TABLE payroll.payroll_settings
  ADD CONSTRAINT payroll_settings_reimbursement_receipt_policy_chk CHECK (
    reimbursement_receipt_policy IS NULL OR (
      COALESCE(jsonb_typeof(reimbursement_receipt_policy) = 'object', false)
      AND COALESCE(jsonb_typeof(reimbursement_receipt_policy->'categories') = 'object', false)
    )
  );

ALTER TABLE payroll.payroll_reimbursements
  ADD COLUMN IF NOT EXISTS receipt_basis varchar(16) NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS self_declared_by uuid,
  ADD COLUMN IF NOT EXISTS self_declared_at timestamptz;

ALTER TABLE payroll.payroll_reimbursements
  DROP CONSTRAINT IF EXISTS payroll_reimbursements_receipt_basis_chk;
ALTER TABLE payroll.payroll_reimbursements
  ADD CONSTRAINT payroll_reimbursements_receipt_basis_chk
  CHECK (receipt_basis IN ('receipt', 'self_declaration', 'not_required'));

-- Claims filed before this migration that carry receipts are 'receipt'.
UPDATE payroll.payroll_reimbursements
   SET receipt_basis = 'receipt'
 WHERE receipt_basis = 'not_required'
   AND COALESCE(cardinality(attachment_keys), 0) > 0;

ALTER TABLE payroll.payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_reimbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_reimbursements FORCE ROW LEVEL SECURITY;
