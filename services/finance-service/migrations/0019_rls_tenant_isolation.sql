-- finance-service RLS migration: tenant isolation backstop
-- Role: finance_svc on civitas_finance
-- Applied AFTER 0018_advances_uc_purpose.sql

-- Helper function: reads app.tenant_id from session variable (SET LOCAL by middleware)
CREATE OR REPLACE FUNCTION budget.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── budget schema ─────────────────────────────────────────────────
ALTER TABLE budget.finance_heads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_budgets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_demands       ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_schemes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_sanctions     ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget.finance_heads         FORCE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_budgets       FORCE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_demands       FORCE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_schemes       FORCE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_sanctions     FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON budget.finance_heads;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budgets;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_demands;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_schemes;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_sanctions;

CREATE POLICY tenant_isolation ON budget.finance_heads     USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON budget.finance_budgets   USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON budget.finance_demands   USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON budget.finance_schemes   USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON budget.finance_sanctions USING (tenant_id = budget.current_tenant_id());

-- ── gl schema ─────────────────────────────────────────────────────
ALTER TABLE gl.finance_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_journals FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ledger   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON gl.finance_journals;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_ledger;

CREATE POLICY tenant_isolation ON gl.finance_journals USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_ledger   USING (tenant_id = budget.current_tenant_id());

-- ── payments schema ───────────────────────────────────────────────
ALTER TABLE payments.finance_bills    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_bills    FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON payments.finance_bills;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_payments;

CREATE POLICY tenant_isolation ON payments.finance_bills    USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON payments.finance_payments USING (tenant_id = budget.current_tenant_id());

-- ── _outbox schema ────────────────────────────────────────────────
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = budget.current_tenant_id());
