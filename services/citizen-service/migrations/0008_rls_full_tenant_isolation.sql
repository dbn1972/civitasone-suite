-- RLS completion: full tenant isolation (USING + WITH CHECK) for citizen-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION portal.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- analytics.citizen_delivery_metrics
ALTER TABLE analytics.citizen_delivery_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.citizen_delivery_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.citizen_delivery_metrics;
DROP POLICY IF EXISTS tenant_isolation ON analytics.citizen_delivery_metrics;
CREATE POLICY tenant_isolation_policy ON analytics.citizen_delivery_metrics
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- analytics.citizen_sla_configs
ALTER TABLE analytics.citizen_sla_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.citizen_sla_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON analytics.citizen_sla_configs;
DROP POLICY IF EXISTS tenant_isolation ON analytics.citizen_sla_configs;
CREATE POLICY tenant_isolation_policy ON analytics.citizen_sla_configs
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- application.citizen_app_documents
ALTER TABLE application.citizen_app_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.citizen_app_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON application.citizen_app_documents;
DROP POLICY IF EXISTS tenant_isolation ON application.citizen_app_documents;
CREATE POLICY tenant_isolation_policy ON application.citizen_app_documents
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- application.citizen_applications
ALTER TABLE application.citizen_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.citizen_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON application.citizen_applications;
DROP POLICY IF EXISTS tenant_isolation ON application.citizen_applications;
CREATE POLICY tenant_isolation_policy ON application.citizen_applications
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- application.citizen_status_history
ALTER TABLE application.citizen_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE application.citizen_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON application.citizen_status_history;
DROP POLICY IF EXISTS tenant_isolation ON application.citizen_status_history;
CREATE POLICY tenant_isolation_policy ON application.citizen_status_history
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- citizen.sla_rules
ALTER TABLE citizen.sla_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen.sla_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON citizen.sla_rules;
DROP POLICY IF EXISTS tenant_isolation ON citizen.sla_rules;
CREATE POLICY tenant_isolation_policy ON citizen.sla_rules
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- grievance.citizen_escalations
ALTER TABLE grievance.citizen_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievance.citizen_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON grievance.citizen_escalations;
DROP POLICY IF EXISTS tenant_isolation ON grievance.citizen_escalations;
CREATE POLICY tenant_isolation_policy ON grievance.citizen_escalations
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- grievance.citizen_grievance_actions
ALTER TABLE grievance.citizen_grievance_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievance.citizen_grievance_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON grievance.citizen_grievance_actions;
DROP POLICY IF EXISTS tenant_isolation ON grievance.citizen_grievance_actions;
CREATE POLICY tenant_isolation_policy ON grievance.citizen_grievance_actions
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- grievance.citizen_grievances
ALTER TABLE grievance.citizen_grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievance.citizen_grievances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON grievance.citizen_grievances;
DROP POLICY IF EXISTS tenant_isolation ON grievance.citizen_grievances;
CREATE POLICY tenant_isolation_policy ON grievance.citizen_grievances
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- helpdesk.citizen_ticket_notes
ALTER TABLE helpdesk.citizen_ticket_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.citizen_ticket_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.citizen_ticket_notes;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.citizen_ticket_notes;
CREATE POLICY tenant_isolation_policy ON helpdesk.citizen_ticket_notes
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- helpdesk.citizen_tickets
ALTER TABLE helpdesk.citizen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.citizen_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.citizen_tickets;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.citizen_tickets;
CREATE POLICY tenant_isolation_policy ON helpdesk.citizen_tickets
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- helpdesk.ticket_escalations
ALTER TABLE helpdesk.ticket_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.ticket_escalations;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.ticket_escalations;
CREATE POLICY tenant_isolation_policy ON helpdesk.ticket_escalations
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- portal.citizen_profiles
ALTER TABLE portal.citizen_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.citizen_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON portal.citizen_profiles;
DROP POLICY IF EXISTS tenant_isolation ON portal.citizen_profiles;
CREATE POLICY tenant_isolation_policy ON portal.citizen_profiles
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- portal.citizen_service_categories
ALTER TABLE portal.citizen_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.citizen_service_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON portal.citizen_service_categories;
DROP POLICY IF EXISTS tenant_isolation ON portal.citizen_service_categories;
CREATE POLICY tenant_isolation_policy ON portal.citizen_service_categories
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- portal.citizen_services
ALTER TABLE portal.citizen_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal.citizen_services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON portal.citizen_services;
DROP POLICY IF EXISTS tenant_isolation ON portal.citizen_services;
CREATE POLICY tenant_isolation_policy ON portal.citizen_services
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- rti.citizen_rti_appeals
ALTER TABLE rti.citizen_rti_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.citizen_rti_appeals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rti.citizen_rti_appeals;
DROP POLICY IF EXISTS tenant_isolation ON rti.citizen_rti_appeals;
CREATE POLICY tenant_isolation_policy ON rti.citizen_rti_appeals
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- rti.citizen_rti_requests
ALTER TABLE rti.citizen_rti_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.citizen_rti_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rti.citizen_rti_requests;
DROP POLICY IF EXISTS tenant_isolation ON rti.citizen_rti_requests;
CREATE POLICY tenant_isolation_policy ON rti.citizen_rti_requests
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- rti.citizen_rti_responses
ALTER TABLE rti.citizen_rti_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rti.citizen_rti_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rti.citizen_rti_responses;
DROP POLICY IF EXISTS tenant_isolation ON rti.citizen_rti_responses;
CREATE POLICY tenant_isolation_policy ON rti.citizen_rti_responses
  USING (tenant_id = portal.current_tenant_id())
  WITH CHECK (tenant_id = portal.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = portal.current_tenant_id())
      WITH CHECK (tenant_id = portal.current_tenant_id())';
  END IF;
END $$;
