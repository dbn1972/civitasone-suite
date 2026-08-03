-- Migration: 0033_ticket_escalations_audit_columns.sql
-- Purpose: Add the standard created_by/updated_by audit columns to
--          helpdesk.ticket_escalations. The table predates the audit-column
--          standard, but the Drizzle schema and the ticketEscalate consumer
--          both write these columns, so every escalation insert failed with
--          'column "created_by" does not exist' — POST /tickets/:id/escalate
--          accepted the command and the write silently died in the consumer.
-- Rollback: ALTER TABLE helpdesk.ticket_escalations
--             DROP COLUMN IF EXISTS created_by,
--             DROP COLUMN IF EXISTS updated_by;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

ALTER TABLE helpdesk.ticket_escalations
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Backfill: the escalating actor is the only attribution any existing row has.
UPDATE helpdesk.ticket_escalations
   SET created_by = COALESCE(created_by, escalated_by),
       updated_by = COALESCE(updated_by, escalated_by)
 WHERE created_by IS NULL
    OR updated_by IS NULL;

ALTER TABLE helpdesk.ticket_escalations
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN updated_by SET NOT NULL;
