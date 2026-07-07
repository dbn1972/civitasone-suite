-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: citizen-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- application.citizen_applications.citizen_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_applications_citizen_id
  ON application.citizen_applications (citizen_id);

-- application.citizen_applications.service_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_applications_service_id
  ON application.citizen_applications (service_id);

-- grievance.citizen_grievances.citizen_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_grievances_citizen_id
  ON grievance.citizen_grievances (citizen_id);

-- grievance.citizen_grievance_actions.officer_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_grievance_actions_officer_id
  ON grievance.citizen_grievance_actions (officer_id);

-- grievance.citizen_escalations.grievance_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_escalations_grievance_id
  ON grievance.citizen_escalations (grievance_id);

-- helpdesk.citizen_tickets.citizen_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_tickets_citizen_id
  ON helpdesk.citizen_tickets (citizen_id);

-- helpdesk.citizen_tickets.assignee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_tickets_assignee_id
  ON helpdesk.citizen_tickets (assignee_id);

-- helpdesk.citizen_ticket_notes.author_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_ticket_notes_author_id
  ON helpdesk.citizen_ticket_notes (author_id);

-- helpdesk.ticket_escalations.ticket_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_escalations_ticket_id
  ON helpdesk.ticket_escalations (ticket_id);

-- portal.citizen_services.category_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_services_category_id
  ON portal.citizen_services (category_id);

-- rti.citizen_rti_requests.citizen_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_rti_requests_citizen_id
  ON rti.citizen_rti_requests (citizen_id);

-- rti.citizen_rti_responses.rti_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_rti_responses_rti_id
  ON rti.citizen_rti_responses (rti_id);

-- rti.citizen_rti_appeals.rti_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_citizen_rti_appeals_rti_id
  ON rti.citizen_rti_appeals (rti_id);
