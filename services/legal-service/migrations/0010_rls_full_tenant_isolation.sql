-- RLS completion: full tenant isolation (USING + WITH CHECK) for legal-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- cases.legal_case_types
ALTER TABLE cases.legal_case_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases.legal_case_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON cases.legal_case_types;
DROP POLICY IF EXISTS tenant_isolation ON cases.legal_case_types;
CREATE POLICY tenant_isolation_policy ON cases.legal_case_types
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- cases.legal_cases
ALTER TABLE cases.legal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases.legal_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON cases.legal_cases;
DROP POLICY IF EXISTS tenant_isolation ON cases.legal_cases;
CREATE POLICY tenant_isolation_policy ON cases.legal_cases
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- cases.legal_parties
ALTER TABLE cases.legal_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases.legal_parties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON cases.legal_parties;
DROP POLICY IF EXISTS tenant_isolation ON cases.legal_parties;
CREATE POLICY tenant_isolation_policy ON cases.legal_parties
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- contracts.legal_clearances
ALTER TABLE contracts.legal_clearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.legal_clearances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON contracts.legal_clearances;
DROP POLICY IF EXISTS tenant_isolation ON contracts.legal_clearances;
CREATE POLICY tenant_isolation_policy ON contracts.legal_clearances
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- contracts.legal_contract_reviews
ALTER TABLE contracts.legal_contract_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.legal_contract_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON contracts.legal_contract_reviews;
DROP POLICY IF EXISTS tenant_isolation ON contracts.legal_contract_reviews;
CREATE POLICY tenant_isolation_policy ON contracts.legal_contract_reviews
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- counsel.legal_counsel_briefs
ALTER TABLE counsel.legal_counsel_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE counsel.legal_counsel_briefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON counsel.legal_counsel_briefs;
DROP POLICY IF EXISTS tenant_isolation ON counsel.legal_counsel_briefs;
CREATE POLICY tenant_isolation_policy ON counsel.legal_counsel_briefs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- filings.legal_filings
ALTER TABLE filings.legal_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE filings.legal_filings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON filings.legal_filings;
DROP POLICY IF EXISTS tenant_isolation ON filings.legal_filings;
CREATE POLICY tenant_isolation_policy ON filings.legal_filings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- hearings.legal_hearings
ALTER TABLE hearings.legal_hearings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hearings.legal_hearings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hearings.legal_hearings;
DROP POLICY IF EXISTS tenant_isolation ON hearings.legal_hearings;
CREATE POLICY tenant_isolation_policy ON hearings.legal_hearings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- hearings.legal_opinions
ALTER TABLE hearings.legal_opinions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hearings.legal_opinions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hearings.legal_opinions;
DROP POLICY IF EXISTS tenant_isolation ON hearings.legal_opinions;
CREATE POLICY tenant_isolation_policy ON hearings.legal_opinions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- hearings.legal_orders
ALTER TABLE hearings.legal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE hearings.legal_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hearings.legal_orders;
DROP POLICY IF EXISTS tenant_isolation ON hearings.legal_orders;
CREATE POLICY tenant_isolation_policy ON hearings.legal_orders
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- notices.legal_notice_responses
ALTER TABLE notices.legal_notice_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices.legal_notice_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON notices.legal_notice_responses;
DROP POLICY IF EXISTS tenant_isolation ON notices.legal_notice_responses;
CREATE POLICY tenant_isolation_policy ON notices.legal_notice_responses
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- notices.legal_notices
ALTER TABLE notices.legal_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices.legal_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON notices.legal_notices;
DROP POLICY IF EXISTS tenant_isolation ON notices.legal_notices;
CREATE POLICY tenant_isolation_policy ON notices.legal_notices
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- opinions.legal_opinions
ALTER TABLE opinions.legal_opinions ENABLE ROW LEVEL SECURITY;
ALTER TABLE opinions.legal_opinions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON opinions.legal_opinions;
DROP POLICY IF EXISTS tenant_isolation ON opinions.legal_opinions;
CREATE POLICY tenant_isolation_policy ON opinions.legal_opinions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- reminders.legal_reminders
ALTER TABLE reminders.legal_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders.legal_reminders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON reminders.legal_reminders;
DROP POLICY IF EXISTS tenant_isolation ON reminders.legal_reminders;
CREATE POLICY tenant_isolation_policy ON reminders.legal_reminders
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- settlements.legal_lok_adalat
ALTER TABLE settlements.legal_lok_adalat ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements.legal_lok_adalat FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON settlements.legal_lok_adalat;
DROP POLICY IF EXISTS tenant_isolation ON settlements.legal_lok_adalat;
CREATE POLICY tenant_isolation_policy ON settlements.legal_lok_adalat
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- settlements.legal_settlements
ALTER TABLE settlements.legal_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements.legal_settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON settlements.legal_settlements;
DROP POLICY IF EXISTS tenant_isolation ON settlements.legal_settlements;
CREATE POLICY tenant_isolation_policy ON settlements.legal_settlements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END $$;
