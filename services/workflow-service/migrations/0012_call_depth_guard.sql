-- ---------------------------------------------------------------------------
-- 0012 — call-activity fork-bomb guard (SECURITY C1).
-- Track the call-activity nesting depth of every instance. Root instances are
-- depth 0; a child spawned by a call node is parent.call_depth + 1. The engine
-- rejects a spawn that would exceed WORKFLOW_MAX_CALL_DEPTH or that would
-- re-enter an ancestor definition (A->...->A cycle). Additive + idempotent.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.instances
  ADD COLUMN IF NOT EXISTS call_depth integer NOT NULL DEFAULT 0;
