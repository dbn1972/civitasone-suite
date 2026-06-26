-- citizen-service RLS migration: tenant isolation backstop
-- Role: citizen_svc on civitas_citizen
-- Applied AFTER 0006_pii_encryption.sql

CREATE OR REPLACE FUNCTION portal.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- portal schema
ALTER TABLE portal.citizen_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.citizen_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portal.citizen_profiles;
CREATE POLICY tenant_isolation ON portal.citizen_profiles USING (tenant_id = portal.current_tenant_id());

ALTER TABLE portal.citizen_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.citizen_service_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portal.citizen_service_categories;
CREATE POLICY tenant_isolation ON portal.citizen_service_categories USING (tenant_id = portal.current_tenant_id());

ALTER TABLE portal.citizen_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.citizen_services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portal.citizen_services;
CREATE POLICY tenant_isolation ON portal.citizen_services USING (tenant_id = portal.current_tenant_id());

-- application schema
ALTER TABLE application.citizen_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.citizen_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application.citizen_applications;
CREATE POLICY tenant_isolation ON application.citizen_applications USING (tenant_id = portal.current_tenant_id());

ALTER TABLE application.citizen_app_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.citizen_app_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application.citizen_app_documents;
CREATE POLICY tenant_isolation ON application.citizen_app_documents USING (tenant_id = portal.current_tenant_id());

ALTER TABLE application.citizen_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.citizen_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON application.citizen_status_history;
CREATE POLICY tenant_isolation ON application.citizen_status_history USING (tenant_id = portal.current_tenant_id());

-- grievance schema
ALTER TABLE grievance.citizen_grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievance.citizen_grievances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grievance.citizen_grievances;
CREATE POLICY tenant_isolation ON grievance.citizen_grievances USING (tenant_id = portal.current_tenant_id());

ALTER TABLE grievance.citizen_grievance_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievance.citizen_grievance_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grievance.citizen_grievance_actions;
CREATE POLICY tenant_isolation ON grievance.citizen_grievance_actions USING (tenant_id = portal.current_tenant_id());

ALTER TABLE grievance.citizen_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievance.citizen_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grievance.citizen_escalations;
CREATE POLICY tenant_isolation ON grievance.citizen_escalations USING (tenant_id = portal.current_tenant_id());

-- rti schema
ALTER TABLE rti.citizen_rti_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.citizen_rti_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rti.citizen_rti_requests;
CREATE POLICY tenant_isolation ON rti.citizen_rti_requests USING (tenant_id = portal.current_tenant_id());

ALTER TABLE rti.citizen_rti_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.citizen_rti_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rti.citizen_rti_responses;
CREATE POLICY tenant_isolation ON rti.citizen_rti_responses USING (tenant_id = portal.current_tenant_id());

ALTER TABLE rti.citizen_rti_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.citizen_rti_appeals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rti.citizen_rti_appeals;
CREATE POLICY tenant_isolation ON rti.citizen_rti_appeals USING (tenant_id = portal.current_tenant_id());

-- helpdesk schema
ALTER TABLE helpdesk.citizen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.citizen_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.citizen_tickets;
CREATE POLICY tenant_isolation ON helpdesk.citizen_tickets USING (tenant_id = portal.current_tenant_id());

ALTER TABLE helpdesk.citizen_ticket_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.citizen_ticket_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.citizen_ticket_notes;
CREATE POLICY tenant_isolation ON helpdesk.citizen_ticket_notes USING (tenant_id = portal.current_tenant_id());

ALTER TABLE helpdesk.ticket_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.ticket_escalations;
CREATE POLICY tenant_isolation ON helpdesk.ticket_escalations USING (tenant_id = portal.current_tenant_id());

-- analytics schema
ALTER TABLE analytics.citizen_sla_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.citizen_sla_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.citizen_sla_configs;
CREATE POLICY tenant_isolation ON analytics.citizen_sla_configs USING (tenant_id = portal.current_tenant_id());

ALTER TABLE analytics.citizen_delivery_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.citizen_delivery_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.citizen_delivery_metrics;
CREATE POLICY tenant_isolation ON analytics.citizen_delivery_metrics USING (tenant_id = portal.current_tenant_id());

-- citizen schema
ALTER TABLE citizen.sla_escalation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen.sla_escalation_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON citizen.sla_escalation_rules;
CREATE POLICY tenant_isolation ON citizen.sla_escalation_rules USING (tenant_id = portal.current_tenant_id());

ALTER TABLE citizen.citizen_sla_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen.citizen_sla_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON citizen.citizen_sla_config;
CREATE POLICY tenant_isolation ON citizen.citizen_sla_config USING (tenant_id = portal.current_tenant_id());

ALTER TABLE citizen.citizen_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen.citizen_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON citizen.citizen_escalations;
CREATE POLICY tenant_isolation ON citizen.citizen_escalations USING (tenant_id = portal.current_tenant_id());

ALTER TABLE citizen.sla_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen.sla_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON citizen.sla_rules;
CREATE POLICY tenant_isolation ON citizen.sla_rules USING (tenant_id = portal.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = portal.current_tenant_id());
