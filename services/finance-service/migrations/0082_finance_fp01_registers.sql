-- Migration 0082 (fp-finance-01): register columns the web screens could not
-- show or capture, plus the debt EMI schedule.
--
--   GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01   advances: sanctioning authority + reason
--   GAP-FINANCE-EXPENDITURE-GUARANTEES-01/-02 guarantees: valid_until, beneficiary, linked_ref
--   GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-01, -NEW-01, -NEW-02
--                                             UC: declaration, verification, rejection reason
--   GAP-FINANCE-DEBT-01                       debt: lender, rate, tenure, outstanding + EMI schedule
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / DROP-then-CREATE.

-- ── advances ──────────────────────────────────────────────────────────────
ALTER TABLE payments.finance_advances ADD COLUMN IF NOT EXISTS sanction_authority text;
ALTER TABLE payments.finance_advances ADD COLUMN IF NOT EXISTS reason text;

-- ── guarantees ────────────────────────────────────────────────────────────
ALTER TABLE treasury.finance_guarantees ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE treasury.finance_guarantees ADD COLUMN IF NOT EXISTS beneficiary text;
ALTER TABLE treasury.finance_guarantees ADD COLUMN IF NOT EXISTS linked_ref text;

-- ── utilisation certificates ──────────────────────────────────────────────
ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS declaration_accepted boolean NOT NULL DEFAULT false;
ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS declared_by uuid;
ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS declared_at timestamptz;
ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS decided_by uuid;
ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS resubmit_count integer NOT NULL DEFAULT 0;

-- ── debt ──────────────────────────────────────────────────────────────────
ALTER TABLE treasury.finance_debt ADD COLUMN IF NOT EXISTS lender text;
-- annual interest rate in basis points (725 = 7.25% p.a.), reducing balance
ALTER TABLE treasury.finance_debt ADD COLUMN IF NOT EXISTS interest_rate_bps integer;
ALTER TABLE treasury.finance_debt ADD COLUMN IF NOT EXISTS tenure_months integer;
ALTER TABLE treasury.finance_debt ADD COLUMN IF NOT EXISTS first_emi_date date;
-- NULL = no schedule recorded (legacy rows); otherwise principal still to be repaid
ALTER TABLE treasury.finance_debt ADD COLUMN IF NOT EXISTS outstanding_minor bigint;
-- GL journal (deterministic id) requested for the loan receipt; its posting status is read from gl.finance_journals.
ALTER TABLE treasury.finance_debt ADD COLUMN IF NOT EXISTS receipt_journal_id uuid;

CREATE TABLE IF NOT EXISTS treasury.finance_debt_emi (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  debt_id         uuid NOT NULL,
  installment_no  integer NOT NULL,
  due_date        date NOT NULL,
  principal_minor bigint NOT NULL,
  interest_minor  bigint NOT NULL,
  total_minor     bigint NOT NULL,
  status          varchar(8) NOT NULL DEFAULT 'due',
  paid_on         date,
  paid_by         uuid,
  payment_ref     text,
  journal_id      uuid,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT finance_debt_emi_status_check CHECK (status IN ('due', 'paid')),
  CONSTRAINT finance_debt_emi_amounts_check
    CHECK (principal_minor >= 0 AND interest_minor >= 0 AND total_minor = principal_minor + interest_minor),
  CONSTRAINT finance_debt_emi_paid_check
    CHECK ((status = 'paid' AND paid_on IS NOT NULL AND paid_by IS NOT NULL) OR (status = 'due' AND paid_on IS NULL)),
  UNIQUE (tenant_id, debt_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_finance_debt_emi_debt ON treasury.finance_debt_emi (tenant_id, debt_id, installment_no);

ALTER TABLE treasury.finance_debt_emi ADD COLUMN IF NOT EXISTS journal_id uuid;

ALTER TABLE treasury.finance_debt_emi ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_debt_emi FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_debt_emi;
CREATE POLICY tenant_isolation_policy ON treasury.finance_debt_emi
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
