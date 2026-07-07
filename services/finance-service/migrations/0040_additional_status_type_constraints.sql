-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: finance-service

SET lock_timeout = '5s';

-- ============================================================================
-- gl.finance_journals.type
-- Valid states: journal, payment, receipt, contra, bill, deposit,
-- deposit_refund, deposit_forfeit, deposit_adjust, payroll, payroll_accrual,
-- depreciation, asset_disposal
-- (validators.ts postJournalBody.type enum: journal|payment|receipt|contra;
-- plus literal "type" values posted by GL-spine callers across modules:
-- payments/consumer.ts "bill"/"payment", treasury/consumer.ts "deposit" and
-- "deposit_{refund|forfeit|adjust}", gl/consumer.ts "payroll"/"depreciation"/
-- "asset_disposal"/"contra" (reversal), integrations/consumer.ts
-- "payroll_accrual")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE gl.finance_journals
    ADD CONSTRAINT finance_journals_type_check
    CHECK (type IN (
      'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
      'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
      'payroll_accrual', 'depreciation', 'asset_disposal'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- gl.finance_journal_lines.journal_type
-- Valid states: same set as gl.finance_journals.type (gl/consumer.ts always
-- sets journalType: journal.type when inserting denormalized lines)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE gl.finance_journal_lines
    ADD CONSTRAINT finance_journal_lines_journal_type_check
    CHECK (journal_type IN (
      'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
      'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
      'payroll_accrual', 'depreciation', 'asset_disposal'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_deposits.type
-- Valid states: pd, emd, sd, fdr
-- (treasury/validators.ts createDepositBody.type enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_deposits
    ADD CONSTRAINT finance_deposits_type_check
    CHECK (type IN ('pd', 'emd', 'sd', 'fdr'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_guarantees.type
-- Valid states: bg, pbg, performance, advance
-- (migration 0001_init.sql column comment: "bg|pbg|performance|advance")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_guarantees
    ADD CONSTRAINT finance_guarantees_type_check
    CHECK (type IN ('bg', 'pbg', 'performance', 'advance'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_pfms.type
-- Valid states: salary, grant, scheme
-- (integrations/consumer.ts: batchType = payrollRunId ? "salary" :
-- disbursementId ? "grant" : "scheme")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_pfms
    ADD CONSTRAINT finance_pfms_type_check
    CHECK (type IN ('salary', 'grant', 'scheme'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_pfms.submission_status
-- Valid states: pending, file_sent, signed, submitted
-- (integrations/consumer.ts sets "pending"/"file_sent" on batch create;
-- pfms/consumer.ts transitions to "signed" then "submitted")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_pfms
    ADD CONSTRAINT finance_pfms_submission_status_check
    CHECK (submission_status IN ('pending', 'file_sent', 'signed', 'submitted'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_advances.type
-- Valid states: employee, vendor, other
-- (payments/validators.ts createAdvanceBody.type enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_advances
    ADD CONSTRAINT finance_advances_type_check
    CHECK (type IN ('employee', 'vendor', 'other'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_bank_statement_lines.match_type
-- Valid states: payment, receipt
-- (bank-recon/consumer.ts calls repo.markLineMatched(tx, lineId, "payment", ...)
-- and (tx, lineId, "receipt", ...) — column is nullable until a match is made)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_bank_statement_lines
    ADD CONSTRAINT finance_bank_statement_lines_match_type_check
    CHECK (match_type IS NULL OR match_type IN ('payment', 'receipt'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- gl.finance_period_reopen_log.from_status
-- Valid states: open, soft_close, hard_close
-- (reuses gl.finance_period_close.status value set — inline CHECK added in
-- migration 0005_world_class.sql and re-asserted as a named constraint in
-- 0036_check_constraints_status_columns.sql; from_status/to_status record
-- transitions between the same states)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE gl.finance_period_reopen_log
    ADD CONSTRAINT finance_period_reopen_log_from_status_check
    CHECK (from_status IN ('open', 'soft_close', 'hard_close'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- gl.finance_period_reopen_log.to_status
-- Valid states: open, soft_close, hard_close (same set as from_status above;
-- consumer.ts/routes.ts only ever set toStatus: "open" on reopen, but the
-- column shares the parent status domain)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE gl.finance_period_reopen_log
    ADD CONSTRAINT finance_period_reopen_log_to_status_check
    CHECK (to_status IN ('open', 'soft_close', 'hard_close'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- budget.finance_major_heads.account_type
-- Valid states: revenue_receipt, capital_receipt, revenue_expenditure,
-- capital_expenditure, expenditure, loan
-- (already enforced by an unnamed inline CHECK added in migration
-- 0010_hoa_pao_voucher.sql; Postgres auto-names it account_type_check-style,
-- so this explicit, named constraint is added defensively — the
-- duplicate_object guard makes re-running this a no-op either way)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE budget.finance_major_heads
    ADD CONSTRAINT finance_major_heads_account_type_check
    CHECK (account_type IN (
      'revenue_receipt', 'capital_receipt', 'revenue_expenditure',
      'capital_expenditure', 'expenditure', 'loan'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- org.legal_entities.entity_type
-- Valid states: company, subsidiary, ddo, pao, branch_office, trust, society,
-- cooperative, llp, proprietorship
-- (org-structure/routes.ts createLegalEntityBody.entityType enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE org.legal_entities
    ADD CONSTRAINT legal_entities_entity_type_check
    CHECK (entity_type IN (
      'company', 'subsidiary', 'ddo', 'pao', 'branch_office', 'trust',
      'society', 'cooperative', 'llp', 'proprietorship'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- org.operating_units.unit_type
-- Valid states: branch, plant, warehouse, office, depot, regional_office,
-- field_office
-- (org-structure/routes.ts createOperatingUnitBody.unitType enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE org.operating_units
    ADD CONSTRAINT operating_units_unit_type_check
    CHECK (unit_type IN (
      'branch', 'plant', 'warehouse', 'office', 'depot', 'regional_office', 'field_office'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_type_check;
ALTER TABLE gl.finance_journal_lines VALIDATE CONSTRAINT finance_journal_lines_journal_type_check;
ALTER TABLE treasury.finance_deposits VALIDATE CONSTRAINT finance_deposits_type_check;
ALTER TABLE treasury.finance_guarantees VALIDATE CONSTRAINT finance_guarantees_type_check;
ALTER TABLE payments.finance_pfms VALIDATE CONSTRAINT finance_pfms_type_check;
ALTER TABLE payments.finance_pfms VALIDATE CONSTRAINT finance_pfms_submission_status_check;
ALTER TABLE payments.finance_advances VALIDATE CONSTRAINT finance_advances_type_check;
ALTER TABLE treasury.finance_bank_statement_lines VALIDATE CONSTRAINT finance_bank_statement_lines_match_type_check;
ALTER TABLE gl.finance_period_reopen_log VALIDATE CONSTRAINT finance_period_reopen_log_from_status_check;
ALTER TABLE gl.finance_period_reopen_log VALIDATE CONSTRAINT finance_period_reopen_log_to_status_check;
ALTER TABLE budget.finance_major_heads VALIDATE CONSTRAINT finance_major_heads_account_type_check;
ALTER TABLE org.legal_entities VALIDATE CONSTRAINT legal_entities_entity_type_check;
ALTER TABLE org.operating_units VALIDATE CONSTRAINT operating_units_unit_type_check;
