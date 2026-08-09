-- Purpose: add helpdesk.tickets.resolved_at, which the SLA metrics query has
--          always read but which no migration has ever created.
--          GET /v1/helpdesk/sla/metrics fails with
--          `column t.resolved_at does not exist` (routes.ts:170). Found after
--          0036 created sla_config and execution reached the next defect.
-- Rollback: ALTER TABLE helpdesk.tickets DROP COLUMN IF EXISTS resolved_at;
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

ALTER TABLE helpdesk.tickets
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Backfill for tickets that are already in a terminal state.
--
-- updated_at is an approximation of when the ticket was resolved: it is the last
-- write of any kind, so a closed ticket edited afterwards will read slightly
-- late. It is used anyway because the alternative is worse — the metrics query
-- is COALESCE(t.resolved_at, NOW()), so leaving these NULL makes every
-- historical ticket look as though it is still being worked, inflating average
-- resolution time without bound as time passes. An approximate past timestamp
-- is closer to the truth than a guaranteed-wrong present one.
--
-- Only historical rows need this; from here on the column is written at the
-- status transition (repo.transitionStatus / repo.reopenIfClosed).
UPDATE helpdesk.tickets
   SET resolved_at = updated_at
 WHERE resolved_at IS NULL
   AND status IN ('resolved', 'closed');

-- The metrics query filters on status and reads resolved_at per tenant.
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status_resolved_at
  ON helpdesk.tickets (tenant_id, status, resolved_at);
