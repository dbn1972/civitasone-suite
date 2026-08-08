-- FN-25 — superior designation for SLA escalation on definition nodes + tasks.
SET lock_timeout = '5s';

ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS escalate_to_ref varchar(128);

ALTER TABLE workflow.tasks
  ADD COLUMN IF NOT EXISTS escalate_to_ref varchar(128);

COMMENT ON COLUMN workflow.definition_nodes.escalate_to_ref IS
  'FN-25: superior designation/role notified on SLA breach for this lane';
COMMENT ON COLUMN workflow.tasks.escalate_to_ref IS
  'FN-25: denormalised escalate target copied from definition node at spawn';
