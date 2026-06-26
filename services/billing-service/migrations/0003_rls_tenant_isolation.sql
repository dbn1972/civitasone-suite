-- billing-service RLS migration: tenant isolation backstop
-- Role: billing_svc on civitas_billing
-- Applied AFTER 0002_billing_lifecycle.sql

CREATE OR REPLACE FUNCTION plans.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- plans schema
ALTER TABLE plans.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans.billing_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plans.billing_plans;
CREATE POLICY tenant_isolation ON plans.billing_plans USING (tenant_id = plans.current_tenant_id());

ALTER TABLE plans.billing_plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans.billing_plan_features FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plans.billing_plan_features;
CREATE POLICY tenant_isolation ON plans.billing_plan_features USING (tenant_id = plans.current_tenant_id());

-- subscriptions schema
ALTER TABLE subscriptions.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.billing_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions.billing_subscriptions;
CREATE POLICY tenant_isolation ON subscriptions.billing_subscriptions USING (tenant_id = plans.current_tenant_id());

ALTER TABLE subscriptions.billing_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.billing_trials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions.billing_trials;
CREATE POLICY tenant_isolation ON subscriptions.billing_trials USING (tenant_id = plans.current_tenant_id());

-- usage schema
ALTER TABLE usage.billing_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage.billing_usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usage.billing_usage_events;
CREATE POLICY tenant_isolation ON usage.billing_usage_events USING (tenant_id = plans.current_tenant_id());

ALTER TABLE usage.billing_usage_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage.billing_usage_aggregates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usage.billing_usage_aggregates;
CREATE POLICY tenant_isolation ON usage.billing_usage_aggregates USING (tenant_id = plans.current_tenant_id());

-- invoices schema
ALTER TABLE invoices.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoices.billing_invoices;
CREATE POLICY tenant_isolation ON invoices.billing_invoices USING (tenant_id = plans.current_tenant_id());

ALTER TABLE invoices.billing_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_invoice_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoices.billing_invoice_items;
CREATE POLICY tenant_isolation ON invoices.billing_invoice_items USING (tenant_id = plans.current_tenant_id());

ALTER TABLE invoices.billing_invoice_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_invoice_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoices.billing_invoice_approvals;
CREATE POLICY tenant_isolation ON invoices.billing_invoice_approvals USING (tenant_id = plans.current_tenant_id());

-- payments schema
ALTER TABLE payments.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.billing_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payments.billing_payments;
CREATE POLICY tenant_isolation ON payments.billing_payments USING (tenant_id = plans.current_tenant_id());

ALTER TABLE payments.billing_gateway_txns ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.billing_gateway_txns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payments.billing_gateway_txns;
CREATE POLICY tenant_isolation ON payments.billing_gateway_txns USING (tenant_id = plans.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = plans.current_tenant_id());
