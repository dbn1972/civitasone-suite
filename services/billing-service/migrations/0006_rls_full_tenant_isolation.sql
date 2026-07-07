-- RLS completion: full tenant isolation (USING + WITH CHECK) for billing-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION plans.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- einvoice.billing_einvoice_requests
ALTER TABLE einvoice.billing_einvoice_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE einvoice.billing_einvoice_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON einvoice.billing_einvoice_requests;
DROP POLICY IF EXISTS tenant_isolation ON einvoice.billing_einvoice_requests;
CREATE POLICY tenant_isolation_policy ON einvoice.billing_einvoice_requests
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- invoices.billing_invoice_approvals
ALTER TABLE invoices.billing_invoice_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_invoice_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_invoice_approvals;
DROP POLICY IF EXISTS tenant_isolation ON invoices.billing_invoice_approvals;
CREATE POLICY tenant_isolation_policy ON invoices.billing_invoice_approvals
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- invoices.billing_invoice_items
ALTER TABLE invoices.billing_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_invoice_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_invoice_items;
DROP POLICY IF EXISTS tenant_isolation ON invoices.billing_invoice_items;
CREATE POLICY tenant_isolation_policy ON invoices.billing_invoice_items
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- invoices.billing_invoices
ALTER TABLE invoices.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_invoices;
DROP POLICY IF EXISTS tenant_isolation ON invoices.billing_invoices;
CREATE POLICY tenant_isolation_policy ON invoices.billing_invoices
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- payments.billing_gateway_txns
ALTER TABLE payments.billing_gateway_txns ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.billing_gateway_txns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.billing_gateway_txns;
DROP POLICY IF EXISTS tenant_isolation ON payments.billing_gateway_txns;
CREATE POLICY tenant_isolation_policy ON payments.billing_gateway_txns
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- payments.billing_payments
ALTER TABLE payments.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.billing_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.billing_payments;
DROP POLICY IF EXISTS tenant_isolation ON payments.billing_payments;
CREATE POLICY tenant_isolation_policy ON payments.billing_payments
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- plans.billing_plan_features
ALTER TABLE plans.billing_plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans.billing_plan_features FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plans.billing_plan_features;
DROP POLICY IF EXISTS tenant_isolation ON plans.billing_plan_features;
CREATE POLICY tenant_isolation_policy ON plans.billing_plan_features
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- plans.billing_plans
ALTER TABLE plans.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans.billing_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plans.billing_plans;
DROP POLICY IF EXISTS tenant_isolation ON plans.billing_plans;
CREATE POLICY tenant_isolation_policy ON plans.billing_plans
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- subscriptions.billing_subscriptions
ALTER TABLE subscriptions.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.billing_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON subscriptions.billing_subscriptions;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions.billing_subscriptions;
CREATE POLICY tenant_isolation_policy ON subscriptions.billing_subscriptions
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- subscriptions.billing_trials
ALTER TABLE subscriptions.billing_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.billing_trials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON subscriptions.billing_trials;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions.billing_trials;
CREATE POLICY tenant_isolation_policy ON subscriptions.billing_trials
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- usage.billing_usage_aggregates
ALTER TABLE usage.billing_usage_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage.billing_usage_aggregates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON usage.billing_usage_aggregates;
DROP POLICY IF EXISTS tenant_isolation ON usage.billing_usage_aggregates;
CREATE POLICY tenant_isolation_policy ON usage.billing_usage_aggregates
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- usage.billing_usage_events
ALTER TABLE usage.billing_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage.billing_usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON usage.billing_usage_events;
DROP POLICY IF EXISTS tenant_isolation ON usage.billing_usage_events;
CREATE POLICY tenant_isolation_policy ON usage.billing_usage_events
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = plans.current_tenant_id())
      WITH CHECK (tenant_id = plans.current_tenant_id())';
  END IF;
END $$;
