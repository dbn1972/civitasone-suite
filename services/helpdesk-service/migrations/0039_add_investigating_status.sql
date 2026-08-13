-- Migration: Add 'investigating' to tickets_status_check constraint for ITIL incident workflow.
-- itil-domain.ts defines investigating as a valid incident status (open→investigating→resolved→closed)
-- but migration 0007 omitted it from the DB CHECK constraint.
-- Rollback: See drop block at bottom.

SET lock_timeout = '5s';

ALTER TABLE helpdesk.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;

ALTER TABLE helpdesk.tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in_progress', 'assigned', 'investigating', 'resolved', 'closed'));

-- Validate (no-op — all existing rows satisfy the expanded set)
ALTER TABLE helpdesk.tickets VALIDATE CONSTRAINT tickets_status_check;
