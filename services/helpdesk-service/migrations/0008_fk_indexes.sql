-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: helpdesk-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Note: tickets.assignee_id already has idx_tickets_assignee — audited and confirmed.

SET lock_timeout = '5s';

-- helpdesk.ticket_escalations.ticket_id (FK to tickets — not covered by composite)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escalations_ticket_id
  ON helpdesk.ticket_escalations (ticket_id);

-- helpdesk.tickets.created_by (FK to user — used for "my tickets" queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_created_by
  ON helpdesk.tickets (created_by);
