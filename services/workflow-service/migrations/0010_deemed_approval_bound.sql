-- 0010_deemed_approval_bound.sql
-- SECURITY C-1/C-3: bound deemed-approval so a timer cannot launder real
-- approvals. A timer node must be EXPLICITLY opted in for deemed-approval
-- before the timer sweeper may auto-complete it (with sodOverride). Non
-- opted-in timers escalate/notify but are never auto-approved.
-- Additive + idempotent only.

-- deemed_approval: opt-in flag on a definition node. Only meaningful for
-- node_type='timer'. Default false => a due timer does NOT auto-approve.
ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS deemed_approval boolean NOT NULL DEFAULT false;
