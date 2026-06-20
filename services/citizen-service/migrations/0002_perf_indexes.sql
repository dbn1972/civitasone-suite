-- citizen-service performance indexes (0002)

CREATE INDEX IF NOT EXISTS idx_citizen_services_tenant_active
  ON portal.citizen_services (tenant_id, active);

CREATE INDEX IF NOT EXISTS idx_citizen_app_documents_application
  ON application.citizen_app_documents (application_id);

CREATE INDEX IF NOT EXISTS idx_citizen_status_history_application
  ON application.citizen_status_history (application_id);

CREATE INDEX IF NOT EXISTS idx_citizen_grievance_actions_grievance
  ON grievance.citizen_grievance_actions (grievance_id);

CREATE INDEX IF NOT EXISTS idx_citizen_tickets_tenant_status
  ON helpdesk.citizen_tickets (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_citizen_ticket_notes_ticket
  ON helpdesk.citizen_ticket_notes (ticket_id);
