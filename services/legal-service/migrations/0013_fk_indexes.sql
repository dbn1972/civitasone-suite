-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: legal-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- cases.legal_cases.case_type_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_cases_case_type_id
  ON cases.legal_cases (case_type_id);

-- cases.legal_parties.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_parties_case_id
  ON cases.legal_parties (case_id);

-- contracts.legal_clearances.review_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_clearances_review_id
  ON contracts.legal_clearances (review_id);

-- counsel.legal_counsel_briefs.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_counsel_briefs_case_id
  ON counsel.legal_counsel_briefs (case_id);

-- counsel.legal_counsel_briefs.hearing_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_counsel_briefs_hearing_id
  ON counsel.legal_counsel_briefs (hearing_id);

-- filings.legal_filings.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_filings_case_id
  ON filings.legal_filings (case_id);

-- hearings.legal_hearings.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_hearings_department_id
  ON hearings.legal_hearings (department_id);

-- hearings.legal_orders.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_orders_case_id
  ON hearings.legal_orders (case_id);

-- notices.legal_notice_responses.notice_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_notice_responses_notice_id
  ON notices.legal_notice_responses (notice_id);

-- opinions.legal_opinions.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_opinions_case_id
  ON opinions.legal_opinions (case_id);

-- reminders.legal_reminders.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_reminders_case_id
  ON reminders.legal_reminders (case_id);

-- settlements.legal_settlements.case_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_settlements_case_id
  ON settlements.legal_settlements (case_id);

-- settlements.legal_lok_adalat.settlement_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_lok_adalat_settlement_id
  ON settlements.legal_lok_adalat (settlement_id);
